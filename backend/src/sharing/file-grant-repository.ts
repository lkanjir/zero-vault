import type { FileGrant } from './file-grant.js';

export type FindFileGrantCommand = {
  fileId: number;
  recipientUserId: number;
};

export interface FileGrantRepository {
  findByFileAndRecipient(command: FindFileGrantCommand): Promise<FileGrant | null>;
}
