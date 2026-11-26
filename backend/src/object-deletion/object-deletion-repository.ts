import type { ObjectDeletionJob } from './object-deletion-job.js';

export type ClaimNextObjectDeletionCommand = {
  claimedAt: Date;
  leaseExpiresAt: Date;
  maxAttempts: number;
};

export type CompleteObjectDeletionCommand = {
  id: number;
  attemptCount: number;
  completedAt: Date;
};

export type RescheduleObjectDeletionCommand = {
  id: number;
  attemptCount: number;
  availableAt: Date;
  errorCode: string;
};

export type MarkObjectDeletionFailedCommand = {
  id: number;
  attemptCount: number;
  failedAt: Date;
  errorCode: string;
};

export interface ObjectDeletionRepository {
  claimNext(command: ClaimNextObjectDeletionCommand): Promise<ObjectDeletionJob | null>;
  complete(command: CompleteObjectDeletionCommand): Promise<boolean>;
  reschedule(command: RescheduleObjectDeletionCommand): Promise<boolean>;
  markFailed(command: MarkObjectDeletionFailedCommand): Promise<boolean>;
}
