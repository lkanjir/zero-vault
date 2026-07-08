export type FileStatus = 'quarantined' | 'available' | 'rejected';

export type File = {
  entryId: number;
  objectKey: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  status: FileStatus;
  statusChangedAt: Date;
  availableAt: Date | null;
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
