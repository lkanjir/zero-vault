import type { Entry } from '../entry/entry.js';
import type { FileGrant, FileGrantPermission } from '../sharing/file-grant.js';

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
  resource: Pick<Entry, 'id' | 'ownerId' | 'kind' | 'deletedAt'>;
  relationship: {
    grant: Pick<FileGrant, 'permission' | 'expiresAt'> | null;
  };
};

export type EffectivePermission = FileGrantPermission | 'owner';
