import { AppError } from '../shared/errors/api/app-error.js';
import type { AuthorizationContextResolver } from './authorization-context-resolver.js';
import type { AuthorizationPolicy } from './authorization-policy.js';
import type {
  AuthorizationAction,
  EffectivePermission,
  EntryAuthorizationContext,
} from './authorization.js';

export type AuthorizedEntry = {
  context: EntryAuthorizationContext;
  effectivePermission: EffectivePermission;
};

export class AuthorizationService {
  constructor(
    private readonly contextResolver: AuthorizationContextResolver,
    private readonly policy: AuthorizationPolicy,
  ) {}

  async authorizeEntry(input: {
    actorUserId: number;
    entryPublicId: string;
    action: AuthorizationAction;
  }): Promise<AuthorizedEntry> {
    const context = await this.contextResolver.resolveEntry({
      actorUserId: input.actorUserId,
      entryPublicId: input.entryPublicId,
      now: new Date(),
    });

    if (context === null) {
      throw new AppError('entry_not_found');
    }

    const decision = this.policy.can(input.action, context);

    if (!decision.allowed) {
      throw new AppError(
        decision.disclosure === 'hidden' ? 'entry_not_found' : 'authorization_denied',
        {
          context: {
            action: input.action,
            reason: decision.reason,
            actorUserId: input.actorUserId,
            entryPublicId: input.entryPublicId,
          },
        },
      );
    }

    return {
      context,
      effectivePermission: decision.effectivePermission,
    };
  }
}
