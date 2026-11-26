import type { TransactionContext } from '../db/unit-of-work.js';
import type { ObjectChecksum } from '../storage/object-storage.js';
import type { UploadIntent, UploadIntentInput } from './upload-intent.js';

export type CompletedUploadFile = {
  entryId: number;
  publicId: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  updatedAt: Date;
};

export type CompleteCreateIntentCommand = {
  intent: UploadIntent;
  userId: number;
  verifiedChecksum: ObjectChecksum;
  completedAt: Date;
};

export type CompleteCreateIntentResult =
  | { kind: 'completed'; file: CompletedUploadFile }
  | { kind: 'duplicate_entry_name' };

export type CompleteReplaceIntentCommand = {
  intent: UploadIntent;
  targetEntryId: number;
  verifiedChecksum: ObjectChecksum;
  completedAt: Date;
};

export type CompleteReplaceIntentResult =
  | {
      kind: 'completed';
      file: CompletedUploadFile;
      previousContentVersion: number;
      newContentVersion: number;
    }
  | { kind: 'superseded' };

export type SaveUploadIntentCommand = {
  upload: UploadIntentInput;
  targetParentId: number | null;
  fileName: string;
};

export type ExpirePendingIntentsCommand = {
  expiredAt: Date;
  limit: number;
};

export type AssertUploadTargetAvailableCommand = {
  userId: number;
  targetParentId: number | null;
  fileName: string;
};

export type SaveReplacementUploadIntentCommand = {
  upload: UploadIntentInput;
  targetFileId: number;
};

export interface UploadIntentRepository {
  findByUserAndUploadId(userId: number, uploadId: string): Promise<UploadIntent | null>;
  findByUserAndUploadIdForUpdate(
    userId: number,
    uploadId: string,
    tx: TransactionContext,
  ): Promise<UploadIntent | null>;
  findCompletedFileByIntentId(
    intentId: number,
    tx: TransactionContext,
  ): Promise<CompletedUploadFile>;
  save(intent: SaveUploadIntentCommand, tx: TransactionContext): Promise<void>;
  saveReplacement(
    command: SaveReplacementUploadIntentCommand,
    tx: TransactionContext,
  ): Promise<void>;
  assertUploadTargetAvailable(
    command: AssertUploadTargetAvailableCommand,
    tx: TransactionContext,
  ): Promise<void>;
  expireLockedIntent(intentId: number, tx: TransactionContext): Promise<void>;
  abortLockedIntent(intentId: number, tx: TransactionContext): Promise<void>;
  completeCreateIntent(
    command: CompleteCreateIntentCommand,
    tx: TransactionContext,
  ): Promise<CompleteCreateIntentResult>;
  completeReplaceIntent(
    command: CompleteReplaceIntentCommand,
    tx: TransactionContext,
  ): Promise<CompleteReplaceIntentResult>;
  expirePendingIntents(command: ExpirePendingIntentsCommand): Promise<number>;
}
