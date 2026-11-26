import type { ObjectStorage } from '../storage/object-storage.js';
import type { ObjectDeletionJob } from './object-deletion-job.js';
import type { ObjectDeletionRepository } from './object-deletion-repository.js';
import { clamp } from '../shared/utils/clamp.js';
import { StorageUnavailableError } from '../shared/errors/storage/storage-unavailable-error.js';

const LEASE_DURATION_MS = 60 * 1000;
const BASE_RETRY_DELAY_MS = 30 * 1000;
const MAX_RETRY_DELAY_MS = 60 * 60 * 1000;
const MAX_ATTEMPTS = 10;

export class ObjectDeletionProcessor {
  constructor(
    private readonly repository: ObjectDeletionRepository,
    private readonly storage: ObjectStorage,
  ) {}

  async processNext(signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) {
      return false;
    }

    const claimedAt = new Date();

    const job = await this.repository.claimNext({
      claimedAt,
      leaseExpiresAt: new Date(claimedAt.getTime() + LEASE_DURATION_MS),
      maxAttempts: MAX_ATTEMPTS,
    });

    if (!job) {
      return false;
    }

    await this.processClaimedJob(job);
    return true;
  }

  private async processClaimedJob(job: ObjectDeletionJob): Promise<void> {
    try {
      await this.storage.deleteObject(job.objectKey);
    } catch (error) {
      const errorCode =
        error instanceof StorageUnavailableError ? 'storage_unavailable' : 'unexpected_error';
      if (job.attemptCount >= MAX_ATTEMPTS) {
        await this.markFailed(job, errorCode, error);
      } else {
        await this.reschedule(job, errorCode, error);
      }
      return;
    }

    const completed = await this.repository.complete({
      id: job.id,
      attemptCount: job.attemptCount,
      completedAt: new Date(),
    });

    if (!completed) {
      console.warn('Object deletion - attempt no longer active', {
        jobId: job.id,
        attemptCount: job.attemptCount,
      });
    }
  }

  private async markFailed(
    job: ObjectDeletionJob,
    errorCode: string,
    error: unknown,
  ): Promise<void> {
    const markedFailed = await this.repository.markFailed({
      id: job.id,
      attemptCount: job.attemptCount,
      failedAt: new Date(),
      errorCode,
    });

    console.error('Object deletion permanently failed after max attempts', {
      jobId: job.id,
      reason: job.reason,
      attemptCount: job.attemptCount,
      errorCode,
      markedFailed,
      error,
    });
  }

  private async reschedule(
    job: ObjectDeletionJob,
    errorCode: string,
    error: unknown,
  ): Promise<void> {
    const failedAt = new Date();
    const rescheduled = await this.repository.reschedule({
      id: job.id,
      attemptCount: job.attemptCount,
      availableAt: new Date(failedAt.getTime() + this.retryDelay(job.attemptCount)),
      errorCode,
    });

    console.error('Object deletion failed', {
      jobId: job.id,
      reason: job.reason,
      attemptCount: job.attemptCount,
      rescheduled,
      error,
    });
  }

  private retryDelay(attemptCount: number): number {
    const exponent = clamp(attemptCount - 1, 0, 10);
    return Math.min(BASE_RETRY_DELAY_MS * 2 ** exponent, MAX_RETRY_DELAY_MS);
  }
}
