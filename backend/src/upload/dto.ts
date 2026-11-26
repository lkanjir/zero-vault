export type SinglePartUploadResponse = {
  uploadMode: 'single';
  uploadId: string;
  uploadUrl: string;
  expiresInSeconds: number;
  requiredHeaders: {
    'Content-Type': string;
    'x-amz-checksum-sha256': string;
  };
};

export type MultipartUploadResponse = {
  uploadMode: 'multipart';
  uploadId: string;
  partSizeBytes: number;
  partCount: number;
  finalizeDeadline: string;
};

export type UploadResponse = SinglePartUploadResponse | MultipartUploadResponse;

export type PresignedUploadPart = {
  partNumber: number;
  uploadUrl: string;
  expiresInSeconds: number;
  requiredHeaders: {
    'x-amz-checksum-sha256': string;
  };
};

export type PresignUploadPartsResponse = {
  uploadId: string;
  parts: PresignedUploadPart[];
};
