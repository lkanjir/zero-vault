export type UploadIntentRequest = {
  fileName: string;
  contentType: string;
  size: number;
  sha256: string;
  parentFolderId: string | null;
};

export type UploadIntentResponse = {
  uploadId: string;
  uploadUrl: string;
  expiresInSeconds: number;
  requiredHeaders: {
    'Content-Type': string;
    'x-amz-checksum-sha256': string;
  };
};

export type FileUploadRequest = {
  file: File;
  url: string;
  headers: {
    'Content-Type': string;
    'x-amz-checksum-sha256': string;
  };
};
