import type {
  AuthorizationAction,
  AuthorizationContext,
  AuthorizationDecision,
  AuthorizationDenialReason,
} from './authorization.js';
import { permissionMatrix } from './permission-matrix.js';

type AuthorizationResourceScope = 'drive-root' | 'file' | 'folder';

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
  can(action: AuthorizationAction, context: AuthorizationContext): AuthorizationDecision {
    const permissionResolution = this.resolveEffectivePermission(context);

    if (!permissionResolution.allowed) {
      return permissionResolution;
    }

    if (!this.isActionApplicable(action, context)) {
      return this.deny('action_not_applicable', 'visible');
    }

    if (!permissionMatrix[permissionResolution.effectivePermission][action]) {
      return this.deny('action_not_allowed', 'visible');
    }

    return permissionResolution;
  }

  private resolveEffectivePermission(context: AuthorizationContext): AuthorizationDecision {
    if (context.scope === 'entry' && context.resource.deletedAt !== null) {
      return this.deny('resource_deleted', 'hidden');
    }

    if (context.actor.userId === context.resource.ownerId) {
      return {
        allowed: true,
        effectivePermission: 'owner',
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
      effectivePermission: grant.permission,
    };
  }

  private deny(
    reason: AuthorizationDenialReason,
    disclosure: 'hidden' | 'visible',
  ): AuthorizationDecision {
    return {
      allowed: false,
      reason,
      disclosure,
    };
  }

  private isActionApplicable(action: AuthorizationAction, context: AuthorizationContext): boolean {
    const resourceScope: AuthorizationResourceScope =
      context.scope === 'drive-root' ? 'drive-root' : context.resource.kind;

    const applicableScopes: readonly AuthorizationResourceScope[] = actionScopes[action];

    return applicableScopes.includes(resourceScope);
  }
}
