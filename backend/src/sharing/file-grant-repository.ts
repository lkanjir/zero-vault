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
  revokedAt: Date;
};

export type UpdateFileGrantCommand = {
  actorUserId: number;
  filePublicId: string;
  grantPublicId: string;
  permission: FileGrantPermission | undefined;
  expiresAt: Date | null | undefined;
  updatedAt: Date;
};

export type MaintainPendingFileGrantsCommand = {
  processedAt: Date;
  limit: number;
};

export type FileGrantMaintenanceResult = {
  activatedCount: number;
  deletedCount: number;
};

export type ListSharedFilesQuery = {
  recipientUserId: number;
  listedAt: Date;
  cursor: {
    sortName: string;
    entryId: number;
  } | null;
  limit: number;
};

export type SharedFileRecord = {
  file: {
    id: string;
    name: string;
    contentType: string;
    sizeBytes: number;
    updatedAt: Date;
  };
  owner: {
    id: number;
    email: string;
    firstName: string;
    lastName: string;
  };
  grant: {
    permission: FileGrantPermission;
    expiresAt: Date | null;
  };
  cursor: {
    sortName: string;
    entryId: number;
  };
};

export type ListOwnedSharedFilesQuery = {
  ownerId: number;
  cursor: {
    sortName: string;
    entryId: number;
  } | null;
  limit: number;
};

export type OwnedSharedFileRecord = {
  file: {
    id: string;
    name: string;
    contentType: string;
    sizeBytes: number;
    updatedAt: Date;
  };
  shareCount: number;
  cursor: {
    sortName: string;
    entryId: number;
  };
};

export interface FileGrantRepository {
  save(command: SaveFileGrantCommand): Promise<FileGrant>;
  listByFileId(query: ListFileGrantsQuery): Promise<FileGrant[]>;
  revoke(command: RevokeFileGrantCommand): Promise<void>;
  update(command: UpdateFileGrantCommand): Promise<FileGrant | null>;
  maintainPending(command: MaintainPendingFileGrantsCommand): Promise<FileGrantMaintenanceResult>;
  listSharedFiles(query: ListSharedFilesQuery): Promise<SharedFileRecord[]>;
  listOwnedSharedFiles(query: ListOwnedSharedFilesQuery): Promise<OwnedSharedFileRecord[]>;
}
