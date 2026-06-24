export type UploadResponse = {
  uploadId: string;
  objectKey: string;
  uploadUrl: string;
  expiresInSeconds: number;
};

export type UploadCompleteResponse = {
  uploadId: string;
  objectKey: string;
  fileName: string;
  contentType: string;
  size: number;
  status: UploadIntentStatus;
};

export type UploadIntentStatus = 'pending' | 'completed' | 'expired';