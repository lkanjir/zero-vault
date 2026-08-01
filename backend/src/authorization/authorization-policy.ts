import type { EntryKind } from '../entry/entry.js';
import type {
  AuthorizationAction,
  DriveRootAuthorizationContext,
  AccessLevel,
  EntryAuthorizationContext,
} from './authorization.js';
import { permissionMatrix } from './permission-matrix.js';

type AuthorizationResourceScope = 'drive-root' | EntryKind;

type PolicyContext = DriveRootAuthorizationContext | EntryAuthorizationContext;

type DenialReason =
  | 'resource_deleted'
  | 'no_active_permission'
  | 'grant_expired'
  | 'action_not_allowed'
  | 'action_not_applicable';

type PolicyDecision =
  | {
      allowed: true;
      accessLevel: AccessLevel;
    }
  | {
      allowed: false;
      reason: DenialReason;
      disclosure: 'hidden' | 'visible';
    };

const actionScopes = {
  'entry:list': ['drive-root', 'folder'],
  'entry:read': ['file', 'folder'],
  'entry:create': ['drive-root', 'folder'],
  'entry:rename': ['file', 'folder'],
  'entry:move': ['file', 'folder'],
  'entry:delete': ['file', 'folder'],
  'file:download': ['file'],
  'file:replace': ['file'],
  'folder:download': ['folder'],
  'share:read': ['file'],
  'share:manage': ['file'],
  'audit:read': ['drive-root', 'file', 'folder'],
} as const satisfies Record<AuthorizationAction, readonly AuthorizationResourceScope[]>;

export class AuthorizationPolicy {
  can(action: AuthorizationAction, context: PolicyContext): PolicyDecision {
    const access = this.resolveAccessLevel(context);

    if (!access.allowed) {
      return access;
    }

    if (!this.isActionApplicable(action, context)) {
      return this.deny('action_not_applicable', 'visible');
    }

    if (!permissionMatrix[access.accessLevel][action]) {
      return this.deny('action_not_allowed', 'visible');
    }

    return access;
  }

  private resolveAccessLevel(context: PolicyContext): PolicyDecision {
    if (context.scope === 'entry' && context.resource.deletedAt !== null) {
      return this.deny('resource_deleted', 'hidden');
    }

    if (context.actor.userId === context.resource.ownerId) {
      return {
        allowed: true,
        accessLevel: 'owner',
      };
    }

    if (context.scope !== 'entry' || context.resource.kind !== 'file') {
      return this.deny('no_active_permission', 'hidden');
    }

    const grant = context.relationship.grant;

    if (grant === null) {
      return this.deny('no_active_permission', 'hidden');
    }

    if (
      grant.expiresAt !== null &&
      grant.expiresAt.getTime() <= context.environment.now.getTime()
    ) {
      return this.deny('grant_expired', 'hidden');
    }

    return {
      allowed: true,
      accessLevel: grant.permission,
    };
  }

  private deny(reason: DenialReason, disclosure: 'hidden' | 'visible'): PolicyDecision {
    return {
      allowed: false,
      reason,
      disclosure,
    };
  }

  private isActionApplicable(action: AuthorizationAction, context: PolicyContext): boolean {
    const resourceScope: AuthorizationResourceScope =
      context.scope === 'drive-root' ? 'drive-root' : context.resource.kind;

    const applicableScopes: readonly AuthorizationResourceScope[] = actionScopes[action];

    return applicableScopes.includes(resourceScope);
  }
}
