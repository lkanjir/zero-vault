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

export interface FileGrantRepository {
  save(command: SaveFileGrantCommand): Promise<FileGrant>;
}
