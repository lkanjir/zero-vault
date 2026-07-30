import { describe, expect, it } from 'vitest';
import { EntryAccessProjector } from '../../src/authorization/entry-access-projector.js';
import { AuthorizationPolicy } from '../../src/authorization/authorization-policy.js';
import type {
  AuthorizationGrantFacts,
  EntryAuthorizationContext,
} from '../../src/authorization/authorization.js';

const NOW = new Date('2026-07-30T12:00:00Z');
const OWNER_ID = 1;
const RECIPIENT_ID = 2;

describe('EntryAccessProjector', () => {
  const projector = new EntryAccessProjector(new AuthorizationPolicy());

  it('projects every owner file capability from the authorization policy', () => {
    expect(projector.project(makeContext({ kind: 'file' }))).toStrictEqual({
      effectivePermission: 'owner',
      capabilities: {
        download: true,
        rename: true,
        replaceContent: true,
        move: true,
        delete: true,
        manageSharing: true,
      },
    });
  });

  it('projects folder-applicable owner capabilities without file-only actions', () => {
    expect(projector.project(makeContext({ kind: 'folder' }))).toStrictEqual({
      effectivePermission: 'owner',
      capabilities: {
        download: true,
        rename: true,
        replaceContent: false,
        move: true,
        delete: true,
        manageSharing: false,
      },
    });
  });

  it.each([
    {
      permission: 'viewer' as const,
      expected: {
        download: true,
        rename: false,
        replaceContent: false,
        move: false,
        delete: false,
        manageSharing: false,
      },
    },
    {
      permission: 'editor' as const,
      expected: {
        download: true,
        rename: true,
        replaceContent: true,
        move: false,
        delete: false,
        manageSharing: false,
      },
    },
  ])('projects $permission file capabilities', ({ permission, expected }) => {
    const context = makeContext({
      actorUserId: RECIPIENT_ID,
      kind: 'file',
      grant: {
        permission,
        expiresAt: null,
      },
    });

    expect(projector.project(context)).toStrictEqual({
      effectivePermission: permission,
      capabilities: expected,
    });
  });

  it('rejects projection when the entry is not readable', () => {
    const context = makeContext({
      actorUserId: RECIPIENT_ID,
      kind: 'file',
      grant: null,
    });

    expect(() => projector.project(context)).toThrow(
      'Cannot project access for an unauthorized entry.',
    );
  });
});

function makeContext(options: {
  actorUserId?: number;
  kind: 'file' | 'folder';
  grant?: AuthorizationGrantFacts | null;
}): EntryAuthorizationContext {
  return {
    scope: 'entry',
    actor: {
      userId: options.actorUserId ?? OWNER_ID,
    },
    resource: {
      id: 10,
      ownerId: OWNER_ID,
      kind: options.kind,
      deletedAt: null,
    },
    relationship: {
      grant: options.grant ?? null,
    },
    environment: {
      now: NOW,
    },
  };
}
