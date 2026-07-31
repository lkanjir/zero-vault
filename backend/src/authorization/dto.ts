import type { EffectivePermission } from './authorization.js';

export type EntryAccessResponse = {
  effectivePermission: EffectivePermission;
  capabilities: {
    download: boolean;
    rename: boolean;
    replaceContent: boolean;
    move: boolean;
    delete: boolean;
    manageSharing: boolean;
  };
};
