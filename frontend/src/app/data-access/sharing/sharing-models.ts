import { CursorPage } from '../../shared/cursor';
import { EntryAccess, FileEntry } from '../entries/entry-models';

export type SharedWithMeFile = FileEntry & {
  owner: {
    email: string;
    firstName: string;
    lastName: string;
  };
  expiresAt: string | null;
  access: EntryAccess;
};

export type SharedWithMeFileList = CursorPage<SharedWithMeFile>;

export type FileSharePermission = 'viewer' | 'editor';

export type ShareFileRequest = {
  recipientEmail: string;
  permission: FileSharePermission;
  expiresAt: string | null;
};

export type ShareFileAcceptedResponse = {
  status: 'accepted';
};

export type FileShare = {
  shareId: string;
  recipientEmail: string;
  permission: FileSharePermission;
  expiresAt: string | null;
};

export type FileShareList = CursorPage<FileShare>;

export type UpdateFileShareRequest = {
  permission: FileSharePermission;
  expiresAt: string | null;
};

export type SharedByMeFile = FileEntry & {
  shareCount: number;
};

export type SharedByMeFileList = CursorPage<SharedByMeFile>;
