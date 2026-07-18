export type File = {
  entryId: number;
  objectKey: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
};

export type DownloadableFile = {
  entryId: number;
  publicId: string;
  ownerId: number;
  name: string;
  objectKey: string;
  contentType: string;
  sizeBytes: number;
};
