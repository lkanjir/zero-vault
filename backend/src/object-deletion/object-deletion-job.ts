export type ObjectDeletionReason =
  | 'expired_upload'
  | 'deleted_file'
  | 'replaced_file'
  | 'superseded_upload'
  | 'expired_folder_archive'
  | 'stale_folder_archive_attempt';

export type ObjectDeletionJob = {
  id: number;
  objectKey: string;
  reason: ObjectDeletionReason;
  createdAt: Date;
  availableAt: Date;
  attemptCount: number;
  leaseExpiresAt: Date | null;
  completedAt: Date | null;
  lastErrorCode: string | null;
};
