export type UploadIntent = {
  createdByUserId: number;
  uploadId: string;
  objectKey: string;
  fileName: string;
  contentType: string;
  size: number;
  status: UploadIntentStatus;
  expectedSha256: string;
  actualSha256?: string | null;
  checksumVerifiedAt?: Date | null;
  createdAt: Date;
  expiredAt: Date;
  completedAt?: Date | null;
};

export type UploadIntentStatus = 'pending' | 'completed' | 'expired';
