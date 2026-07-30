import type { AuthorizationPolicy } from './authorization-policy.js';
import type { AuthorizationAction, EntryAuthorizationContext } from './authorization.js';
import type { EntryAccessResponse } from './dto.js';

export class EntryAccessProjector {
  constructor(private readonly policy: AuthorizationPolicy) {}

  project(context: EntryAuthorizationContext): EntryAccessResponse {
    const readDecision = this.policy.can('entry:read', context);
    if (!readDecision.allowed) {
      throw new Error('Cannot project access for an unauthorized entry.');
    }

    const can = (action: AuthorizationAction): boolean => this.policy.can(action, context).allowed;

    const downloadAction: AuthorizationAction =
      context.resource.kind === 'file' ? 'file:download' : 'folder:download';

    return {
      effectivePermission: readDecision.effectivePermission,
      capabilities: {
        download: can(downloadAction),
        rename: can('entry:rename'),
        replaceContent: can('file:replace'),
        move: can('entry:move'),
        delete: can('entry:delete'),
        manageSharing: can('share:manage'),
      },
    };
  }
}
