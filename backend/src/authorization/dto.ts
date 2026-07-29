import type { EffectivePermission } from './authorization.js';

export type EntryCapabilitiesResponse = {
  download: boolean;
  rename: boolean;
  replaceContent: boolean;
  move: boolean;
  delete: boolean;
  manageSharing: boolean;
};

export type EntryAccessResponse = {
  effectivePermission: EffectivePermission;
  capabilities: EntryCapabilitiesResponse;
};
