import { AppError } from '../shared/errors/api/app-error.js';
import type { AuthorizationContextResolver } from './authorization-context-resolver.js';
import type { AuthorizationPolicy } from './authorization-policy.js';
import type {
  AuthorizationAction,
  EffectivePermission,
  EntryAuthorizationContext,
} from './authorization.js';

export type AuthorizationEntryCommand = {
  actorUserId: number;
  entryPublicId: string;
  action: AuthorizationAction;
};

export type AuthorizationEntryResult = {
  context: EntryAuthorizationContext;
  effectivePermission: EffectivePermission;
};

export class AuthorizationService {
  constructor(
    private readonly contextResolver: AuthorizationContextResolver,
    private readonly policy: AuthorizationPolicy,
  ) {}

  async authorizeEntry(command: AuthorizationEntryCommand): Promise<AuthorizationEntryResult> {
    const context = await this.contextResolver.resolveEntry({
      actorUserId: command.actorUserId,
      entryPublicId: command.entryPublicId,
      now: new Date(),
    });

    if (context === null) {
      throw new AppError('entry_not_found');
    }

    const decision = this.policy.can(command.action, context);

    if (!decision.allowed) {
      throw new AppError(
        decision.disclosure === 'hidden' ? 'entry_not_found' : 'authorization_denied',
        {
          context: {
            action: command.action,
            reason: decision.reason,
            actorUserId: command.actorUserId,
            entryPublicId: command.entryPublicId,
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
