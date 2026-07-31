import type { Entry } from '../entry/entry.js';
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

export type AuthorizationGrantFacts = {
  permission: FileGrantPermission;
  expiresAt: Date | null;
};

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
    grant: AuthorizationGrantFacts | null;
  };
};

export type AuthorizationContext = DriveRootAuthorizationContext | EntryAuthorizationContext;

export type AuthorizationDenialReason =
  | 'resource_deleted'
  | 'no_active_permission'
  | 'grant_expired'
  | 'action_not_allowed'
  | 'action_not_applicable';

export type EffectivePermission = FileGrantPermission | 'owner';

export type AuthorizationDecision =
  | {
      allowed: true;
      effectivePermission: EffectivePermission;
    }
  | {
      allowed: false;
      reason: AuthorizationDenialReason;
      disclosure: 'hidden' | 'visible';
    };
