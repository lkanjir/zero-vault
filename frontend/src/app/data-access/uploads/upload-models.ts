export type UploadContentRequest = {
  contentType: string;
  size: number;
  sha256?: string;
};

export type UploadConflictStrategy = 'fail' | 'rename';

export type CreateUploadIntentRequest = UploadContentRequest & {
  fileName: string;
  parentFolderId: string | null;
  conflictStrategy?: UploadConflictStrategy;
};

export type SinglePartUploadIntentResponse = {
  uploadMode: 'single';
  uploadId: string;
  uploadUrl: string;
  expiresInSeconds: number;
  requiredHeaders: {
    'Content-Type': string;
    'x-amz-checksum-sha256': string;
  };
};

export type MultipartUploadIntentResponse = {
  uploadMode: 'multipart';
  uploadId: string;
  partSizeBytes: number;
  partCount: number;
  finalizeDeadline: string;
};

export type UploadIntentResponse = SinglePartUploadIntentResponse | MultipartUploadIntentResponse;

export type FileUploadRequest = {
  file: File;
  url: string;
  headers: {
    'Content-Type': string;
    'x-amz-checksum-sha256': string;
  };
};

export type PresignPartItemRequest = {
  partNumber: number;
  sha256: string;
};

export type PresignUploadPartsRequest = {
  parts: readonly PresignPartItemRequest[];
};

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

export type PartUploadRequest = {
  body: ArrayBuffer;
  url: string;
  headers: {
    'x-amz-checksum-sha256': string;
  };
};

export type CompletedUploadPart = {
  partNumber: number;
  etag: string;
  sha256: string;
};

export type CompleteUploadRequest = {
  parts?: readonly CompletedUploadPart[];
};
