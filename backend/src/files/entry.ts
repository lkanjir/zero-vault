export type EntryKind = 'file' | 'folder';

export type Entry = {
  id: number;
  publicId: string;
  ownerId: number;
  parentId: number;
  kind: EntryKind;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
};
