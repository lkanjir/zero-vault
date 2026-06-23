export type SignedUrlParams = {
  objectKey: string;
  contentType: string;
  expiresInSeconds: number;
};

export type UploadUrlRequest = {
  fileName: string;
  contentType: string;
};

export type UploadUrlResponse = {
  objectKey: string;
  uploadUrl: string;
  expiresInSeconds: number;
};
