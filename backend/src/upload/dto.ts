export type UploadResponse = {
  uploadId: string;
  uploadUrl: string;
  expiresInSeconds: number;
  requiredHeaders: {
    'Content-Type': string;
    'x-amz-checksum-sha256': string;
  };
};

export type UploadCompleteResponse = {
  uploadId: string;
  fileId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  fileStatus: 'quarantined';
};
