export type UploadIntentStatus = 'pending' | 'completed' | 'expired';

export type UploadIntent = {
  id?: number;
  uploadId: string;
  fileId?: number | null;
  createdByUserId: number;
  targetParentId?: number | null;
  fileName: string;
  objectKey: string;
  contentType: string;
  expectedSizeBytes: number;
  expectedSha256: string;
  status: UploadIntentStatus;
  createdAt: Date;
  uploadUrlExpiresAt: Date;
  completedAt?: Date | null;
  finalizeDeadline: Date;
};
