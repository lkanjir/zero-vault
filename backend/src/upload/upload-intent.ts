export type UploadIntentStatus = 'pending' | 'completed' | 'expired' | 'superseded' | 'aborted';

export type UploadIntentOperation = 'create' | 'replace';

export type UploadMode = 'single' | 'multipart';

export type ChecksumType = 'full_sha256' | 'composite_sha256';

export type UploadIntent = {
  id: number;
  uploadId: string;
  fileId: number | null;
  createdByUserId: number;
  targetParentId: number | null;
  fileName: string | null;
  objectKey: string;
  contentType: string;
  expectedSizeBytes: number;
  expectedSha256: string | null;
  uploadMode: UploadMode;
  s3UploadId: string | null;
  partSizeBytes: number | null;
  partCount: number | null;
  checksumType: ChecksumType;
  status: UploadIntentStatus;
  createdAt: Date;
  uploadUrlExpiresAt: Date | null;
  completedAt: Date | null;
  finalizeDeadline: Date;
  operation: UploadIntentOperation;
  targetFileId: number | null;
  expectedContentVersion: number | null;
};

export type UploadIntentInput = {
  uploadId: string;
  createdByUserId: number;
  objectKey: string;
  contentType: string;
  expectedSizeBytes: number;
  expectedSha256: string | null;
  uploadMode: UploadMode;
  s3UploadId: string | null;
  partSizeBytes: number | null;
  partCount: number | null;
  checksumType: ChecksumType;
  createdAt: Date;
  uploadUrlExpiresAt: Date | null;
  finalizeDeadline: Date;
};
