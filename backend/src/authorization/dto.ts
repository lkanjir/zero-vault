import type { AccessLevel } from './authorization.js';

export type EntryAccessResponse = {
  accessLevel: AccessLevel;
  capabilities: {
    download: boolean;
    rename: boolean;
    replaceContent: boolean;
    move: boolean;
    delete: boolean;
    manageSharing: boolean;
  };
};
