import { describe, expect, it } from 'vitest';
import { AuthorizationPolicy } from '../../src/authorization/authorization-policy.js';
import type { EntryAuthorizationContext } from '../../src/authorization/authorization.js';
import { EntryAccessMapper } from '../../src/authorization/entry-access-mapper.js';
import type { FileGrantPermission } from '../../src/sharing/file-grant.js';

const NOW = new Date('2026-07-30T12:00:00Z');
const OWNER_ID = 1;
const RECIPIENT_ID = 2;

describe('EntryAccessMapper', () => {
  const mapper = new EntryAccessMapper(new AuthorizationPolicy());

  it('maps every owner file capability from the authorization policy', () => {
    expect(mapper.map(makeContext({ kind: 'file' }))).toStrictEqual({
      accessLevel: 'owner',
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

  it('maps folder-applicable owner capabilities without file-only actions', () => {
    expect(mapper.map(makeContext({ kind: 'folder' }))).toStrictEqual({
      accessLevel: 'owner',
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
  ])('maps $permission file capabilities', ({ permission, expected }) => {
    const context = makeContext({
      actorUserId: RECIPIENT_ID,
      kind: 'file',
      grant: {
        permission,
        expiresAt: null,
      },
    });

    expect(mapper.map(context)).toStrictEqual({
      accessLevel: permission,
      capabilities: expected,
    });
  });

  it('rejects mapping when the entry is not readable', () => {
    const context = makeContext({
      actorUserId: RECIPIENT_ID,
      kind: 'file',
      grant: null,
    });

    expect(() => mapper.map(context)).toThrow('Cannot map access for an unauthorized entry.');
  });
});

function makeContext(options: {
  actorUserId?: number;
  kind: 'file' | 'folder';
  grant?: {
    permission: FileGrantPermission;
    expiresAt: Date | null;
  } | null;
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
