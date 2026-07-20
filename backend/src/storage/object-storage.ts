import type { Readable } from 'node:stream';

export type SignedUploadUrlParams = {
  objectKey: string;
  contentType: string;
  expiresInSeconds: number;
  sha256Hex: string;
};

export type ObjectMetadata = {
  objectKey: string;
  sizeBytes: number;
  contentType: string;
  sha256Hex: string | null;
};

export type ObjectMetadataWithChecksum = ObjectMetadata & {
  sha256Hex: string;
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
};

export interface ObjectStorage {
  createPresignedUploadUrl(params: SignedUploadUrlParams): Promise<string>;
  createPresignedDownloadUrl(params: SignedDownloadUrlParams): Promise<string>;
  headObject(objectKey: string): Promise<ObjectMetadata>;
  getObjectStream(objectKey: string): Promise<Readable>;
  uploadObjectStream(params: UploadObjectStreamParams): Promise<void>;
  deleteObject(objectKey: string): Promise<void>;
  deleteObjects(objectKeys: string[]): Promise<string[]>;
}
