export type UploadIntent = {
  id: string;
  objectKey: string;
  fileName: string;
  contentType: string;
  size: number;
  status: UploadIntentStatus;
  createdAt: Date;
  expiredAt: Date;
};

export type UploadIntentStatus = 'pending' | 'completed' | 'expired';
