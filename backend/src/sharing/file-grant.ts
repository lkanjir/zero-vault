import type { GrantPermission } from '../authorization/authorization.js';

export type FileGrant = {
  id: number;
  publicId: string;
  fileId: number;
  recipientUserId: number;
  createdByUserId: number;
  permission: GrantPermission;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
