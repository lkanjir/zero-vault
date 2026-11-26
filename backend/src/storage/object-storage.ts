import type { Readable } from 'node:stream';

export type SignedUploadUrlParams = {
  objectKey: string;
  contentType: string;
  sizeBytes: number;
  expiresInSeconds: number;
  sha256Hex: string;
};

export type CreateMultipartUploadParams = {
  objectKey: string;
  contentType: string;
};

export type SignedUploadPartUrlParams = {
  objectKey: string;
  s3UploadId: string;
  partNumber: number;
  sizeBytes: number;
  expiresInSeconds: number;
  sha256Hex: string;
};

export type CompletedMultipartPart = {
  partNumber: number;
  etag: string;
  sha256Hex: string;
};

export type CompleteMultipartUploadParams = {
  objectKey: string;
  s3UploadId: string;
  parts: readonly CompletedMultipartPart[];
};

export type CompleteMultipartUploadResult = {
  compositeChecksum: string | null;
};

export type ObjectChecksum =
  | { type: 'full_sha256'; value: string }
  | { type: 'composite_sha256'; value: string };

export type ObjectMetadata = {
  objectKey: string;
  sizeBytes: number;
  contentType: string;
  checksum: ObjectChecksum | null;
};

export type ObjectMetadataWithChecksum = ObjectMetadata & {
  checksum: ObjectChecksum;
};

export type SignedDownloadUrlParams = {
  objectKey: string;
  fileName: string;
  contentType: string;
  expiresInSeconds: number;
};

export type UploadObjectStreamParams = {
  objectKey: string;
  contentType: string;
  body: Readable;
  signal?: AbortSignal;
};

export interface ObjectStorage {
  createPresignedUploadUrl(params: SignedUploadUrlParams): Promise<string>;
  createMultipartUpload(params: CreateMultipartUploadParams): Promise<string>;
  createPresignedUploadPartUrl(params: SignedUploadPartUrlParams): Promise<string>;
  completeMultipartUpload(
    params: CompleteMultipartUploadParams,
  ): Promise<CompleteMultipartUploadResult>;
  abortMultipartUpload(objectKey: string, s3UploadId: string): Promise<void>;
  createPresignedDownloadUrl(params: SignedDownloadUrlParams): Promise<string>;
  headObject(objectKey: string): Promise<ObjectMetadata>;
  getObjectStream(objectKey: string, signal?: AbortSignal): Promise<Readable>;
  uploadObjectStream(params: UploadObjectStreamParams): Promise<void>;
  deleteObject(objectKey: string): Promise<void>;
}
