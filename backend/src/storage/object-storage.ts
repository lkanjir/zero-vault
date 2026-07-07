export type SignedUrlParams = {
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

export interface ObjectStorage {
  createPresignedUrl(params: SignedUrlParams): Promise<string>;
  headObject(location: ObjectLocation, objectKey: string): Promise<ObjectMetadata>;
  copyObject(from: ObjectLocation, to: ObjectLocation, objectKey: string): Promise<void>;
}
