import type { UploadIntentStatus } from './upload-intent.js';

export type UploadResponse = {
  uploadId: string;
  uploadUrl: string;
  sha256Base64: string;
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
