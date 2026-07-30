import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import type { AuthorizationContextResolver } from '../../src/authorization/authorization-context-resolver.js';
import type { AuthorizationPolicy } from '../../src/authorization/authorization-policy.js';
import { AuthorizationService } from '../../src/authorization/authorization-service.js';
import type { EntryAuthorizationContext } from '../../src/authorization/authorization.js';

const NOW = new Date('2026-07-30T12:00:00Z');
const ACTOR_USER_ID = 2;
const ENTRY_PUBLIC_ID = '20000000-0000-4000-8000-000000000001';

describe('AuthorizationService', () => {
  let contextResolver: MockProxy<AuthorizationContextResolver>;
  let policy: MockProxy<AuthorizationPolicy>;
  let service: AuthorizationService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    contextResolver = mock<AuthorizationContextResolver>();
    policy = mock<AuthorizationPolicy>();
    service = new AuthorizationService(contextResolver, policy);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the trusted context and effective permission when access is allowed', async () => {
    const context = makeContext();
    contextResolver.resolveEntry.mockResolvedValue(context);
    policy.can.mockReturnValue({
      allowed: true,
      effectivePermission: 'viewer',
    });

    await expect(
      service.authorizeEntry({
        actorUserId: ACTOR_USER_ID,
        entryPublicId: ENTRY_PUBLIC_ID,
        action: 'file:download',
      }),
    ).resolves.toStrictEqual({
      context,
      effectivePermission: 'viewer',
    });
    expect(contextResolver.resolveEntry).toHaveBeenCalledExactlyOnceWith({
      actorUserId: ACTOR_USER_ID,
      entryPublicId: ENTRY_PUBLIC_ID,
      now: NOW,
    });
    expect(policy.can).toHaveBeenCalledExactlyOnceWith('file:download', context);
  });

  it('returns the same hidden not-found response when the entry does not exist', async () => {
    contextResolver.resolveEntry.mockResolvedValue(null);

    await expect(
      service.authorizeEntry({
        actorUserId: ACTOR_USER_ID,
        entryPublicId: ENTRY_PUBLIC_ID,
        action: 'entry:read',
      }),
    ).rejects.toMatchObject({
      code: 'entry_not_found',
    });
    expect(policy.can).not.toHaveBeenCalled();
  });

  it('maps a hidden policy denial to entry_not_found', async () => {
    const context = makeContext();
    contextResolver.resolveEntry.mockResolvedValue(context);
    policy.can.mockReturnValue({
      allowed: false,
      reason: 'grant_expired',
      disclosure: 'hidden',
    });

    await expect(
      service.authorizeEntry({
        actorUserId: ACTOR_USER_ID,
        entryPublicId: ENTRY_PUBLIC_ID,
        action: 'file:download',
      }),
    ).rejects.toMatchObject({
      code: 'entry_not_found',
      options: {
        context: {
          action: 'file:download',
          reason: 'grant_expired',
          actorUserId: ACTOR_USER_ID,
          entryPublicId: ENTRY_PUBLIC_ID,
        },
      },
    });
  });

  it('maps a visible policy denial to authorization_denied', async () => {
    const context = makeContext();
    contextResolver.resolveEntry.mockResolvedValue(context);
    policy.can.mockReturnValue({
      allowed: false,
      reason: 'action_not_allowed',
      disclosure: 'visible',
    });

    await expect(
      service.authorizeEntry({
        actorUserId: ACTOR_USER_ID,
        entryPublicId: ENTRY_PUBLIC_ID,
        action: 'entry:rename',
      }),
    ).rejects.toMatchObject({
      code: 'authorization_denied',
      options: {
        context: {
          action: 'entry:rename',
          reason: 'action_not_allowed',
          actorUserId: ACTOR_USER_ID,
          entryPublicId: ENTRY_PUBLIC_ID,
        },
      },
    });
  });
});

function makeContext(): EntryAuthorizationContext {
  return {
    scope: 'entry',
    actor: {
      userId: ACTOR_USER_ID,
    },
    resource: {
      id: 10,
      ownerId: 1,
      kind: 'file',
      deletedAt: null,
    },
    relationship: {
      grant: {
        permission: 'viewer',
        expiresAt: null,
      },
    },
    environment: {
      now: NOW,
    },
  };
}
