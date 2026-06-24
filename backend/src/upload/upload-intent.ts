export type UploadIntent = {
  uploadId: string;
  objectKey: string;
  fileName: string;
  contentType: string;
  size: number;
  status: UploadIntentStatus;
  sha256: string;
  createdAt: Date;
  expiredAt: Date;
  completedAt?: Date | null;
};

export type UploadIntentStatus = 'pending' | 'completed' | 'expired';
