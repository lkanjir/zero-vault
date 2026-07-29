import type { EntryKind } from '../entry/entry.js';

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

export type GrantPermission = 'viewer' | 'editor';

export type AuthorizationGrantFacts = {
  permission: GrantPermission;
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
  resource: {
    id: number;
    ownerId: number;
    kind: EntryKind;
    deletedAt: Date | null;
  };
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

export type EffectivePermission = GrantPermission | 'owner';

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
