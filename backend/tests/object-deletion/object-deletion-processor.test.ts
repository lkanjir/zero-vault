import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import type { ObjectDeletionJob } from '../../src/object-deletion/object-deletion-job.js';
import { ObjectDeletionProcessor } from '../../src/object-deletion/object-deletion-processor.js';
import type { ObjectDeletionRepository } from '../../src/object-deletion/object-deletion-repository.js';
import { StorageUnavailableError } from '../../src/shared/errors/storage/storage-unavailable-error.js';
import type { ObjectStorage } from '../../src/storage/object-storage.js';

const NOW = new Date('2026-07-28T10:00:00.000Z');

describe('ObjectDeletionProcessor', () => {
  let repository: MockProxy<ObjectDeletionRepository>;
  let storage: MockProxy<ObjectStorage>;
  let processor: ObjectDeletionProcessor;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    repository = mock<ObjectDeletionRepository>();
    storage = mock<ObjectStorage>();
    processor = new ObjectDeletionProcessor(repository, storage);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns false when no deletion job is due', async () => {
    repository.claimNext.mockResolvedValue(null);

    await expect(processor.processNext()).resolves.toBe(false);

    expect(repository.claimNext).toHaveBeenCalledExactlyOnceWith({
      claimedAt: NOW,
      leaseExpiresAt: new Date(NOW.getTime() + 60_000),
      maxAttempts: 10,
    });
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('does not claim work when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(processor.processNext(controller.signal)).resolves.toBe(false);
    expect(repository.claimNext).not.toHaveBeenCalled();
  });

  it('deletes the object and completes the active attempt', async () => {
    const job = makeJob();
    repository.claimNext.mockResolvedValue(job);
    repository.complete.mockResolvedValue(true);

    await expect(processor.processNext()).resolves.toBe(true);

    expect(storage.deleteObject).toHaveBeenCalledExactlyOnceWith(job.objectKey);
    expect(repository.complete).toHaveBeenCalledExactlyOnceWith({
      id: job.id,
      attemptCount: job.attemptCount,
      completedAt: NOW,
    });
    expect(repository.reschedule).not.toHaveBeenCalled();
  });

  it('reschedules a storage failure with the initial backoff', async () => {
    const job = makeJob({ attemptCount: 1 });
    const storageError = new StorageUnavailableError(
      { operation: 'delete_object', objectKey: job.objectKey },
      { cause: new Error('storage down') },
    );
    repository.claimNext.mockResolvedValue(job);
    repository.reschedule.mockResolvedValue(true);
    storage.deleteObject.mockRejectedValue(storageError);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(processor.processNext()).resolves.toBe(true);

    expect(repository.reschedule).toHaveBeenCalledExactlyOnceWith({
      id: job.id,
      attemptCount: job.attemptCount,
      availableAt: new Date(NOW.getTime() + 30_000),
      errorCode: 'storage_unavailable',
    });
    expect(repository.complete).not.toHaveBeenCalled();
  });

  it('uses exponential backoff for repeated unexpected failures', async () => {
    const job = makeJob({ attemptCount: 4 });
    repository.claimNext.mockResolvedValue(job);
    repository.reschedule.mockResolvedValue(true);
    storage.deleteObject.mockRejectedValue(new Error('unexpected'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await processor.processNext();

    expect(repository.reschedule).toHaveBeenCalledExactlyOnceWith({
      id: job.id,
      attemptCount: job.attemptCount,
      availableAt: new Date(NOW.getTime() + 4 * 60_000),
      errorCode: 'unexpected_error',
    });
  });

  it('caps deletion retry backoff at one hour before maxAttempts', async () => {
    const job = makeJob({ attemptCount: 9 });
    repository.claimNext.mockResolvedValue(job);
    repository.reschedule.mockResolvedValue(true);
    storage.deleteObject.mockRejectedValue(new Error('unexpected'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await processor.processNext();

    expect(repository.reschedule).toHaveBeenCalledExactlyOnceWith({
      id: job.id,
      attemptCount: job.attemptCount,
      availableAt: new Date(NOW.getTime() + 60 * 60_000),
      errorCode: 'unexpected_error',
    });
    expect(repository.markFailed).not.toHaveBeenCalled();
  });

  it('marks a deletion job permanently failed once maxAttempts is reached', async () => {
    const job = makeJob({ attemptCount: 10 });
    const storageError = new StorageUnavailableError(
      { operation: 'delete_object', objectKey: job.objectKey },
      { cause: new Error('persistent storage failure') },
    );
    repository.claimNext.mockResolvedValue(job);
    repository.markFailed.mockResolvedValue(true);
    storage.deleteObject.mockRejectedValue(storageError);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(processor.processNext()).resolves.toBe(true);

    expect(repository.markFailed).toHaveBeenCalledExactlyOnceWith({
      id: job.id,
      attemptCount: 10,
      failedAt: NOW,
      errorCode: 'storage_unavailable',
    });
    expect(repository.reschedule).not.toHaveBeenCalled();
    expect(repository.complete).not.toHaveBeenCalled();
  });
});

function makeJob(overrides: Partial<ObjectDeletionJob> = {}): ObjectDeletionJob {
  return {
    id: 10,
    objectKey: 'users/user/objects/file',
    s3UploadId: null,
    reason: 'deleted_file',
    createdAt: new Date('2026-07-28T09:00:00.000Z'),
    availableAt: NOW,
    attemptCount: 1,
    leaseExpiresAt: new Date(NOW.getTime() + 60_000),
    completedAt: null,
    failedAt: null,
    lastErrorCode: null,
    ...overrides,
  };
}
