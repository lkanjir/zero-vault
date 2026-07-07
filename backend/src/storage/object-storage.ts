export type SignedUrlParams = {
  objectKey: string;
  contentType: string;
  expiresInSeconds: number;
  sha256Hex: string;
};

export type ObjectMetadata = {
  objectKey: string;
  size: number;
  contentType: string;
  sha256Hex: string | null;
};

export type ObjectMetadataWithChecksum = ObjectMetadata & {
  sha256Hex: string;
};

export interface ObjectStorage {
  createPresignedUrl(params: SignedUrlParams): Promise<string>;
  headObject(objectKey: string): Promise<ObjectMetadata>;
}
