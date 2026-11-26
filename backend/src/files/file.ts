export type DownloadableFile = {
  entryId: number;
  publicId: string;
  ownerId: number;
  name: string;
  objectKey: string;
  contentType: string;
  sizeBytes: number;
};
