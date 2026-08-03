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
