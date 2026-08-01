import { AppError } from '../shared/errors/api/app-error.js';
import type { AuthorizationContextResolver } from './authorization-context-resolver.js';
import type { AuthorizationPolicy } from './authorization-policy.js';
import type {
  AuthorizationAction,
  AccessLevel,
  EntryAuthorizationContext,
} from './authorization.js';

export type AuthorizationResult = {
  context: EntryAuthorizationContext;
  accessLevel: AccessLevel;
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
  }): Promise<AuthorizationResult> {
    const context = await this.contextResolver.resolveEntry({
      actorUserId: input.actorUserId,
      entryPublicId: input.entryPublicId,
      now: new Date(),
    });

    if (context === null) {
      throw new AppError('entry_not_found');
    }

    return this.authorizeEntryContext({
      action: input.action,
      entryPublicId: input.entryPublicId,
      context,
    });
  }

  authorizeEntryContext(input: {
    action: AuthorizationAction;
    entryPublicId: string;
    context: EntryAuthorizationContext;
  }): AuthorizationResult {
    const decision = this.policy.can(input.action, input.context);

    if (!decision.allowed) {
      throw new AppError(
        decision.disclosure === 'hidden' ? 'entry_not_found' : 'authorization_denied',
        {
          context: {
            action: input.action,
            reason: decision.reason,
            actorUserId: input.context.actor.userId,
            entryPublicId: input.entryPublicId,
          },
        },
      );
    }

    return {
      context: input.context,
      accessLevel: decision.accessLevel,
    };
  }
}
