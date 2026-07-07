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
