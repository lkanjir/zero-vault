import type { EntryKind } from '../entry/entry.js';
import type { FileGrantPermission } from '../sharing/file-grant.js';

export const authorizationActions = [
  'entry:list',
  'entry:read',
  'entry:create',
  'entry:rename',
  'entry:move',
  'entry:delete',
  'file:download',
  'file:replace',
  'folder:download',
  'share:read',
  'share:manage',
  'audit:read',
] as const;

export type AuthorizationAction = (typeof authorizationActions)[number];

type AuthorizationContextBase = {
  actor: {
    userId: number;
  };
  environment: {
    now: Date;
  };
};

export type DriveRootAuthorizationContext = AuthorizationContextBase & {
  scope: 'drive-root';
  resource: {
    ownerId: number;
  };
};

export type EntryAuthorizationContext = AuthorizationContextBase & {
  scope: 'entry';
  resource: {
    id: number;
    ownerId: number;
    kind: EntryKind;
    deletedAt: Date | null;
  };
  relationship: {
    grant: {
      permission: FileGrantPermission;
      expiresAt: Date | null;
    } | null;
  };
};

export type AccessLevel = FileGrantPermission | 'owner';
