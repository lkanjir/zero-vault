export type FileGrantPermission = 'viewer' | 'editor';

export type FileGrant = {
  id: number;
  publicId: string;
  fileId: number;
  recipientUserId: number;
  createdByUserId: number;
  permission: FileGrantPermission;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
