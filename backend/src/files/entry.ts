export type EntryKind = 'file' | 'folder';

export type Entry = {
  id: number;
  publicId: string;
  ownerId: number;
  parentId: number | null;
  kind: EntryKind;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};
