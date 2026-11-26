import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import type { FolderArchiver } from '../../src/folder/download/folder-archiver.js';
import { FolderDownloadProcessor } from '../../src/folder/download/folder-download-processor.js';
import type { FolderDownloadRepository } from '../../src/folder/download/folder-download-repository.js';
import type {
  FolderArchiveEntry,
  FolderDownload,
} from '../../src/folder/download/folder-download.js';

const NOW = new Date('2026-07-28T10:00:00.000Z');
const MANIFEST: FolderArchiveEntry[] = [
  { kind: 'folder', pathParts: ['Documents'] },
  {
    kind: 'file',
    pathParts: ['Documents', 'report.txt'],
    objectKey: 'users/user/objects/report',
    sizeBytes: 12,
  },
];

describe('FolderDownloadProcessor', () => {
  let repository: MockProxy<FolderDownloadRepository>;
  let archiver: MockProxy<FolderArchiver>;
  let processor: FolderDownloadProcessor;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    repository = mock<FolderDownloadRepository>();
    archiver = mock<FolderArchiver>();
    processor = new FolderDownloadProcessor(repository, archiver);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns false when no folder download is available', async () => {
    repository.claimNext.mockResolvedValue(null);

    await expect(processor.processNext()).resolves.toBe(false);

    expect(repository.claimNext).toHaveBeenCalledExactlyOnceWith({
      claimedAt: NOW,
      leaseExpiresAt: new Date(NOW.getTime() + 15 * 60 * 1_000),
      maxAttempts: 3,
    });
    expect(repository.getArchiveManifest).not.toHaveBeenCalled();
    expect(archiver.create).not.toHaveBeenCalled();
  });

  it('creates an archive and completes the active attempt', async () => {
    const download = makeDownload();
    repository.claimNext.mockResolvedValue(download);
    repository.getArchiveManifest.mockResolvedValue(MANIFEST);
    archiver.create.mockResolvedValue({ sizeBytes: 321 });
    repository.completeArchiveAttempt.mockResolvedValue('ready');

    await expect(processor.processNext()).resolves.toBe(true);

    const archiveObjectKey = `${download.archiveObjectKey}/${download.attemptCount}.zip`;
    expect(repository.getArchiveManifest).toHaveBeenCalledExactlyOnceWith({
      ownerId: download.ownerId,
      rootFolderId: download.folderId,
      rootFolderName: download.folderName,
    });
    expect(archiver.create).toHaveBeenCalledOnce();
    const [createCommand] = archiver.create.mock.lastCall!;
    expect(createCommand.entries).toBe(MANIFEST);
    expect(createCommand.archiveObjectKey).toBe(archiveObjectKey);
    expect(createCommand.signal).toBeInstanceOf(AbortSignal);
    expect(repository.completeArchiveAttempt).toHaveBeenCalledExactlyOnceWith({
      id: download.id,
      attemptCount: download.attemptCount,
      archiveObjectKey,
      archiveSizeBytes: 321,
      finishedAt: NOW,
      expiresAt: new Date(NOW.getTime() + 60 * 60 * 1_000),
    });
    expect(repository.markFailed).not.toHaveBeenCalled();
  });

  it('accepts a stale completion outcome without marking the newer attempt failed', async () => {
    const download = makeDownload();
    repository.claimNext.mockResolvedValue(download);
    repository.getArchiveManifest.mockResolvedValue(MANIFEST);
    archiver.create.mockResolvedValue({ sizeBytes: 321 });
    repository.completeArchiveAttempt.mockResolvedValue('stale');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(processor.processNext()).resolves.toBe(true);

    expect(repository.markFailed).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('Folder download attempt is no longer active', {
      downloadId: download.downloadId,
      attemptCount: download.attemptCount,
      archiveObjectKey: `${download.archiveObjectKey}/${download.attemptCount}.zip`,
    });
  });

  it('marks an active attempt failed when archive creation fails', async () => {
    const download = makeDownload();
    const archiveError = new Error('archive failed');
    repository.claimNext.mockResolvedValue(download);
    repository.getArchiveManifest.mockResolvedValue(MANIFEST);
    archiver.create.mockRejectedValue(archiveError);
    repository.markFailed.mockResolvedValue(true);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(processor.processNext()).resolves.toBe(true);

    expect(repository.completeArchiveAttempt).not.toHaveBeenCalled();
    expect(repository.markFailed).toHaveBeenCalledExactlyOnceWith({
      id: download.id,
      attemptCount: download.attemptCount,
      failureCode: 'archive_creation_failed',
      finishedAt: NOW,
    });
    expect(log).toHaveBeenCalledWith('Folder download processing failed', {
      downloadId: download.downloadId,
      attemptCount: download.attemptCount,
      failureCode: 'archive_creation_failed',
      markedFailed: true,
      error: archiveError,
    });
  });

  it('marks the download as folder_unavailable when the archive manifest is empty', async () => {
    const download = makeDownload();
    repository.claimNext.mockResolvedValue(download);
    repository.getArchiveManifest.mockResolvedValue([]);
    repository.markFailed.mockResolvedValue(true);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(processor.processNext()).resolves.toBe(true);

    expect(archiver.create).not.toHaveBeenCalled();
    expect(repository.completeArchiveAttempt).not.toHaveBeenCalled();
    expect(repository.markFailed).toHaveBeenCalledExactlyOnceWith({
      id: download.id,
      attemptCount: download.attemptCount,
      failureCode: 'folder_unavailable',
      finishedAt: NOW,
    });
    expect(log).toHaveBeenCalledWith('Folder download processing failed', {
      downloadId: download.downloadId,
      attemptCount: download.attemptCount,
      failureCode: 'folder_unavailable',
      markedFailed: true,
    });
  });

  it('renews the lease periodically while archiving and stops after completion', async () => {
    const download = makeDownload();
    let resolveArchive!: (result: { sizeBytes: number }) => void;

    repository.claimNext.mockResolvedValue(download);
    repository.getArchiveManifest.mockResolvedValue(MANIFEST);
    repository.renewLease.mockResolvedValue(true);
    repository.completeArchiveAttempt.mockResolvedValue('ready');
    archiver.create.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveArchive = resolve;
        }),
    );

    const processPromise = processor.processNext();

    await vi.advanceTimersByTimeAsync(5 * 60 * 1_000);
    expect(repository.renewLease).toHaveBeenCalledTimes(1);
    expect(repository.renewLease).toHaveBeenNthCalledWith(1, {
      id: download.id,
      attemptCount: download.attemptCount,
      leaseExpiresAt: new Date(NOW.getTime() + 20 * 60 * 1_000),
    });

    await vi.advanceTimersByTimeAsync(5 * 60 * 1_000);
    expect(repository.renewLease).toHaveBeenCalledTimes(2);
    expect(repository.renewLease).toHaveBeenNthCalledWith(2, {
      id: download.id,
      attemptCount: download.attemptCount,
      leaseExpiresAt: new Date(NOW.getTime() + 25 * 60 * 1_000),
    });

    resolveArchive({ sizeBytes: 512 });
    await expect(processPromise).resolves.toBe(true);

    await vi.advanceTimersByTimeAsync(15 * 60 * 1_000);
    expect(repository.renewLease).toHaveBeenCalledTimes(2);
  });

  it('aborts archiving immediately without marking failed when lease renewal returns false', async () => {
    const download = makeDownload();
    let capturedSignal: AbortSignal | undefined;

    repository.claimNext.mockResolvedValue(download);
    repository.getArchiveManifest.mockResolvedValue(MANIFEST);
    repository.renewLease.mockResolvedValue(false);
    archiver.create.mockImplementationOnce(({ signal }) => {
      capturedSignal = signal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener(
          'abort',
          () => reject(signal.reason instanceof Error ? signal.reason : new Error('aborted')),
          { once: true },
        );
      });
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const processPromise = processor.processNext();

    await vi.advanceTimersByTimeAsync(5 * 60 * 1_000);
    await expect(processPromise).resolves.toBe(true);

    expect(capturedSignal?.aborted).toBe(true);
    expect(repository.markFailed).not.toHaveBeenCalled();
    expect(repository.completeArchiveAttempt).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('Folder download lease lost; aborting archive creation', {
      downloadId: download.downloadId,
      attemptCount: download.attemptCount,
    });
  });

  it('does not claim work when the external signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(processor.processNext(controller.signal)).resolves.toBe(false);
    expect(repository.claimNext).not.toHaveBeenCalled();
  });

  it('aborts in-flight archiving on shutdown without marking the download permanently failed', async () => {
    const download = makeDownload();
    const shutdownController = new AbortController();
    let capturedSignal: AbortSignal | undefined;

    repository.claimNext.mockResolvedValue(download);
    repository.getArchiveManifest.mockResolvedValue(MANIFEST);
    archiver.create.mockImplementationOnce(({ signal }) => {
      capturedSignal = signal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('shutdown')), { once: true });
      });
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const processPromise = processor.processNext(shutdownController.signal);
    await Promise.resolve();
    await Promise.resolve();

    shutdownController.abort(new Error('SIGTERM'));

    await expect(processPromise).resolves.toBe(true);
    expect(capturedSignal?.aborted).toBe(true);
    expect(repository.markFailed).not.toHaveBeenCalled();
    expect(repository.completeArchiveAttempt).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('Folder download processing aborted due to worker shutdown', {
      downloadId: download.downloadId,
      attemptCount: download.attemptCount,
    });
  });

  it('does not mark an uploaded archive failed when persisting its completion fails', async () => {
    const download = makeDownload();
    const persistenceError = new Error('database unavailable');
    repository.claimNext.mockResolvedValue(download);
    repository.getArchiveManifest.mockResolvedValue(MANIFEST);
    archiver.create.mockResolvedValue({ sizeBytes: 321 });
    repository.completeArchiveAttempt.mockRejectedValue(persistenceError);

    await expect(processor.processNext()).rejects.toBe(persistenceError);

    expect(repository.markFailed).not.toHaveBeenCalled();
  });
});

function makeDownload(overrides: Partial<FolderDownload> = {}): FolderDownload {
  return {
    id: 10,
    downloadId: '30000000-0000-4000-8000-000000000001',
    ownerId: 1,
    folderId: 20,
    folderName: 'Documents',
    archiveObjectKey:
      'folder-downloads/10000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001',
    status: 'processing',
    attemptCount: 1,
    archiveSizeBytes: null,
    failureCode: null,
    createdAt: new Date('2026-07-28T09:59:00.000Z'),
    startedAt: NOW,
    finishedAt: null,
    leaseExpiresAt: new Date(NOW.getTime() + 15 * 60 * 1_000),
    expiresAt: null,
    ...overrides,
  };
}
