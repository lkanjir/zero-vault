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

export type ObjectLocation = 'quarantine' | 'live';

export type SignedDownloadUrlParams = {
  objectKey: string;
  fileName: string;
  contentType: string;
  expiresInSeconds: number;
};

export interface ObjectStorage {
  createPresignedUploadUrl(params: SignedUploadUrlParams): Promise<string>;
  createPresignedDownloadUrl(params: SignedDownloadUrlParams): Promise<string>;
  headObject(location: ObjectLocation, objectKey: string): Promise<ObjectMetadata>;
  copyObject(from: ObjectLocation, to: ObjectLocation, objectKey: string): Promise<void>;
  deleteObject(from: ObjectLocation, objectKey: string): Promise<void>;
}
