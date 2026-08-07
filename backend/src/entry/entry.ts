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

export const ENTRY_LIST_SORTS = ['name-asc', 'name-desc', 'updated-desc', 'updated-asc'] as const;

export type EntryListSort = (typeof ENTRY_LIST_SORTS)[number];
