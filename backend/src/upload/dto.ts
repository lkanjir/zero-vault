export type UploadResponse = {
  uploadId: string;
  uploadUrl: string;
  sha256Base64: string;
  expiresInSeconds: number;
};

export type UploadCompleteResponse = {
  uploadId: string;
  fileId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  fileStatus: 'quarantined';
};
