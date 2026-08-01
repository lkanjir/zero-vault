export type FileGrantPermission = 'viewer' | 'editor';

export type FileGrant = {
  id: number;
  publicId: string;
  fileId: number;
  recipientUserId: number | null;
  recipientEmail: string;
  createdByUserId: number;
  permission: FileGrantPermission;
  expiresAt: Date | null;
  activationDeadline: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
