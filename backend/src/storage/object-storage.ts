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

export interface ObjectStorage {
  createPresignedUploadUrl(params: SignedUploadUrlParams): Promise<string>;
  createPresignedDownloadUrl(params: SignedDownloadUrlParams): Promise<string>;
  headObject(objectKey: string): Promise<ObjectMetadata>;
  deleteObject(objectKey: string): Promise<void>;
}
