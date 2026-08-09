import { describe, expect, it } from 'vitest';
import {
  authorizationActions,
  type AuthorizationAction,
  type DriveRootAuthorizationContext,
  type EntryAuthorizationContext,
} from '../../src/authorization/authorization.js';
import { AuthorizationPolicy } from '../../src/authorization/authorization-policy.js';
import type { FileGrantPermission } from '../../src/sharing/file-grant.js';

const NOW = new Date('2026-07-29T12:00:00.000Z');
const OWNER_ID = 1;
const OTHER_USER_ID = 2;

const ROOT_ACTIONS = new Set<AuthorizationAction>(['entry:list', 'entry:create', 'audit:read']);

const FILE_ACTIONS = new Set<AuthorizationAction>([
  'entry:read',
  'entry:rename',
  'entry:move',
  'entry:delete',
  'file:download',
  'file:replace',
  'share:read',
  'share:manage',
]);

const FOLDER_ACTIONS = new Set<AuthorizationAction>([
  'entry:list',
  'entry:read',
  'entry:create',
  'entry:rename',
  'entry:move',
  'entry:delete',
  'folder:download',
]);

const GRANTEE_PERMISSION_CASES: ReadonlyArray<{
  permission: FileGrantPermission;
  allowedActions: ReadonlySet<AuthorizationAction>;
}> = [
  {
    permission: 'viewer',
    allowedActions: new Set<AuthorizationAction>(['entry:read', 'file:download']),
  },
  {
    permission: 'editor',
    allowedActions: new Set<AuthorizationAction>([
      'entry:read',
      'entry:rename',
      'file:download',
      'file:replace',
    ]),
  },
];

describe('AuthorizationPolicy', () => {
  const policy = new AuthorizationPolicy();

  it('defines unique authorization action names', () => {
    expect(new Set(authorizationActions).size).toBe(authorizationActions.length);
  });

  it.each([
    {
      scope: 'drive-root',
      context: makeDriveRootContext(),
      applicableActions: ROOT_ACTIONS,
    },
    {
      scope: 'file',
      context: makeEntryContext({ kind: 'file' }),
      applicableActions: FILE_ACTIONS,
    },
    {
      scope: 'folder',
      context: makeEntryContext({ kind: 'folder' }),
      applicableActions: FOLDER_ACTIONS,
    },
  ])(
    'allows every applicable owner action and rejects inapplicable actions for $scope',
    ({ context, applicableActions }) => {
      for (const action of authorizationActions) {
        const decision = policy.can(action, context);

        if (applicableActions.has(action)) {
          expect(decision, action).toStrictEqual({
            allowed: true,
            accessLevel: 'owner',
          });
        } else {
          expect(decision, action).toStrictEqual({
            allowed: false,
            reason: 'action_not_applicable',
            disclosure: 'visible',
          });
        }
      }
    },
  );

  it.each(GRANTEE_PERMISSION_CASES)(
    'applies the complete $permission permission matrix to a shared file',
    ({ permission, allowedActions }) => {
      const context = makeEntryContext({
        actorUserId: OTHER_USER_ID,
        kind: 'file',
        grant: {
          permission,
          expiresAt: null,
        },
      });

      for (const action of authorizationActions) {
        const decision = policy.can(action, context);

        if (!FILE_ACTIONS.has(action)) {
          expect(decision, action).toStrictEqual({
            allowed: false,
            reason: 'action_not_applicable',
            disclosure: 'visible',
          });
        } else if (allowedActions.has(action)) {
          expect(decision, action).toStrictEqual({
            allowed: true,
            accessLevel: permission,
          });
        } else {
          expect(decision, action).toStrictEqual({
            allowed: false,
            reason: 'action_not_allowed',
            disclosure: 'visible',
          });
        }
      }
    },
  );

  it('hides an entry from a non-owner without a grant before checking the action', () => {
    const context = makeEntryContext({
      actorUserId: OTHER_USER_ID,
      kind: 'file',
      grant: null,
    });

    expect(policy.can('entry:read', context)).toStrictEqual({
      allowed: false,
      reason: 'no_active_permission',
      disclosure: 'hidden',
    });
    expect(policy.can('folder:download', context)).toStrictEqual({
      allowed: false,
      reason: 'no_active_permission',
      disclosure: 'hidden',
    });
  });

  it.each([
    {
      caseName: 'before the current time',
      expiresAt: new Date(NOW.getTime() - 1),
    },
    {
      caseName: 'exactly at the current time',
      expiresAt: NOW,
    },
  ])('treats a grant expiring $caseName as expired', ({ expiresAt }) => {
    const context = makeEntryContext({
      actorUserId: OTHER_USER_ID,
      kind: 'file',
      grant: {
        permission: 'viewer',
        expiresAt,
      },
    });

    expect(policy.can('entry:read', context)).toStrictEqual({
      allowed: false,
      reason: 'grant_expired',
      disclosure: 'hidden',
    });
  });

  it('accepts a grant whose expiry is still in the future', () => {
    const context = makeEntryContext({
      actorUserId: OTHER_USER_ID,
      kind: 'file',
      grant: {
        permission: 'viewer',
        expiresAt: new Date(NOW.getTime() + 1),
      },
    });

    expect(policy.can('file:download', context)).toStrictEqual({
      allowed: true,
      accessLevel: 'viewer',
    });
  });

  it('hides a deleted entry before evaluating ownership or grant state', () => {
    const context = makeEntryContext({
      actorUserId: OTHER_USER_ID,
      kind: 'file',
      deletedAt: NOW,
      grant: {
        permission: 'editor',
        expiresAt: new Date(NOW.getTime() - 1),
      },
    });

    expect(policy.can('file:download', context)).toStrictEqual({
      allowed: false,
      reason: 'resource_deleted',
      disclosure: 'hidden',
    });
  });

  it('hides another users drive root', () => {
    const context = makeDriveRootContext({
      actorUserId: OTHER_USER_ID,
    });

    expect(policy.can('entry:list', context)).toStrictEqual({
      allowed: false,
      reason: 'no_active_permission',
      disclosure: 'hidden',
    });
  });

  it('does not apply a grant to a folder while folder sharing is unsupported', () => {
    const context = makeEntryContext({
      actorUserId: OTHER_USER_ID,
      kind: 'folder',
      grant: {
        permission: 'editor',
        expiresAt: null,
      },
    });

    expect(policy.can('entry:read', context)).toStrictEqual({
      allowed: false,
      reason: 'no_active_permission',
      disclosure: 'hidden',
    });
  });

  it('derives owner permission without consulting grant expiry', () => {
    const context = makeEntryContext({
      kind: 'file',
      grant: {
        permission: 'viewer',
        expiresAt: new Date(NOW.getTime() - 1),
      },
    });

    expect(policy.can('file:download', context)).toStrictEqual({
      allowed: true,
      accessLevel: 'owner',
    });
  });
});

function makeDriveRootContext(
  overrides: {
    actorUserId?: number;
    ownerId?: number;
    now?: Date;
  } = {},
): DriveRootAuthorizationContext {
  return {
    scope: 'drive-root',
    actor: {
      userId: overrides.actorUserId ?? OWNER_ID,
    },
    resource: {
      ownerId: overrides.ownerId ?? OWNER_ID,
    },
    environment: {
      now: overrides.now ?? NOW,
    },
  };
}

function makeEntryContext(options: {
  actorUserId?: number;
  ownerId?: number;
  kind: 'file' | 'folder';
  deletedAt?: Date | null;
  grant?: {
    permission: FileGrantPermission;
    expiresAt: Date | null;
  } | null;
  now?: Date;
}): EntryAuthorizationContext {
  return {
    scope: 'entry',
    actor: {
      userId: options.actorUserId ?? OWNER_ID,
    },
    resource: {
      id: 10,
      ownerId: options.ownerId ?? OWNER_ID,
      kind: options.kind,
      deletedAt: options.deletedAt ?? null,
    },
    relationship: {
      grant: options.grant ?? null,
    },
    environment: {
      now: options.now ?? NOW,
    },
  };
}
