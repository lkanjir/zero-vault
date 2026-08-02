import type { FileGrant, FileGrantPermission } from './file-grant.js';

export type SaveFileGrantCommand = {
  actorUserId: number;
  filePublicId: string;
  recipientEmail: string;
  permission: FileGrantPermission;
  expiresAt: Date | null;
  submittedAt: Date;
  pendingActivationDeadline: Date;
};

export type ListFileGrantsQuery = {
  fileId: number;
  cursor: {
    recipientEmail: string;
    grantDbId: number;
  } | null;
  limit: number;
};

export type RevokeFileGrantCommand = {
  actorUserId: number;
  filePublicId: string;
  grantPublicId: string;
};

export type UpdateFileGrantCommand = {
  actorUserId: number;
  filePublicId: string;
  grantPublicId: string;
  permission?: FileGrantPermission;
  expiresAt?: Date | null;
  updatedAt: Date;
};

export interface FileGrantRepository {
  save(command: SaveFileGrantCommand): Promise<FileGrant>;
  listByFileId(query: ListFileGrantsQuery): Promise<FileGrant[]>;
  revoke(command: RevokeFileGrantCommand): Promise<void>;
  update(command: UpdateFileGrantCommand): Promise<FileGrant | null>;
}
