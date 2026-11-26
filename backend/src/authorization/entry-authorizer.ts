import type { TransactionContext } from '../db/unit-of-work.js';
import type { Entry } from '../entry/entry.js';
import type { AuthorizationAction, EntryAuthorizationContext } from './authorization.js';

export type AuthorizedEntry = {
  entry: Entry;
  context: EntryAuthorizationContext;
};

export type AuthorizeEntryInput = {
  actorUserId: number;
  entryPublicId: string;
  actions: readonly AuthorizationAction[];
};

export type AuthorizeEntryByDbIdInput = {
  actorUserId: number;
  entryDbId: number;
  actions: readonly AuthorizationAction[];
};

export type AuthorizeParentForCreateInput = {
  actorUserId: number;
  ownerId: number;
  parentPublicId: string | null;
};

export type ReauthorizeParentForCreateInput = {
  actorUserId: number;
  ownerId: number;
  parentId: number | null;
};

export interface EntryAuthorizer {
  authorizeForRead(input: AuthorizeEntryInput, tx: TransactionContext): Promise<AuthorizedEntry>;
  authorizeForUpdate(input: AuthorizeEntryInput, tx: TransactionContext): Promise<AuthorizedEntry>;
  authorizeForUpdateByDbId(
    input: AuthorizeEntryByDbIdInput,
    tx: TransactionContext,
  ): Promise<AuthorizedEntry>;
  authorizeParentForCreate(
    input: AuthorizeParentForCreateInput,
    tx: TransactionContext,
  ): Promise<number | null>;
  reauthorizeParentForCreate(
    input: ReauthorizeParentForCreateInput,
    tx: TransactionContext,
  ): Promise<void>;
}
