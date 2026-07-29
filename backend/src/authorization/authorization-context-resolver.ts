import type { EntryAuthorizationContext } from './authorization.js';

export type ResolveEntryAuthorizationContextCommand = {
  actorUserId: number;
  entryPublicId: string;
  now: Date;
};

export interface AuthorizationContextResolver {
  resolveEntry(
    command: ResolveEntryAuthorizationContextCommand,
  ): Promise<EntryAuthorizationContext | null>;
}
