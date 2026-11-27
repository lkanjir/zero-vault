export type FolderResponse = {
  kind: 'folder';
  id: string;
  name: string;
  updatedAt: string;
};

export type EnsureFolderTreeResponse = {
  folders: Record<string, string>;
};
