import { CursorPage } from '../../shared/cursor';
import { EntryAccess, FileEntry } from '../entries/entry-models';

export type SharedFile = FileEntry & {
  owner: {
    email: string;
    firstName: string;
    lastName: string;
  };
  expiresAt: string | null;
  access: EntryAccess;
};

export type SharedFileList = CursorPage<SharedFile>;

export type SharedFileListParams = {
  cursor: string | null;
  limit: number;
};

export type FileSharePermission = 'viewer' | 'editor';

export type ShareFileRequest = {
  recipientEmail: string;
  permission: FileSharePermission;
  expiresAt: string | null;
};

export type ShareFileAcceptedResponse = {
  status: 'accepted';
};
