import type { EntryAuthorizationContext } from './authorization.js';

export type ResolveEntryContextInput = {
  actorUserId: number;
  entryPublicId: string;
  now: Date;
};

export interface AuthorizationContextResolver {
  resolveEntry(input: ResolveEntryContextInput): Promise<EntryAuthorizationContext | null>;
}
