export type UploadIntentStatus = 'pending' | 'completed' | 'expired' | 'superseded';

export type UploadIntentOperation = 'create' | 'replace';

export type UploadIntent = {
  id?: number;
  uploadId: string;
  fileId?: number | null;
  createdByUserId: number;
  targetParentId?: number | null;
  fileName: string | null;
  objectKey: string;
  contentType: string;
  expectedSizeBytes: number;
  expectedSha256: string;
  status: UploadIntentStatus;
  createdAt: Date;
  uploadUrlExpiresAt: Date;
  completedAt?: Date | null;
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
  expectedSha256: string;
  createdAt: Date;
  uploadUrlExpiresAt: Date;
  finalizeDeadline: Date;
};
