export type SignedUrlParams = {
  objectKey: string;
  contentType: string;
  expiresInSeconds: number;
  sha256: string;
};

export type ObjectMetadata = {
  objectKey: string;
  size: number;
  contentType: string;
  etag?: string | undefined;
};

export interface ObjectStorage {
  createPresignedUrl(params: SignedUrlParams): Promise<string>;
  headObject(objectKey: string): Promise<ObjectMetadata>;
}
