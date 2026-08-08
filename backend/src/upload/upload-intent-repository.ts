import type { UploadIntentInput, UploadIntent } from './upload-intent.js';

export type CompleteVerifiedUploadCommand = {
  userId: number;
  uploadId: string;
  completedAt: Date;
};

export type CompletedUploadFile = {
  entryId: number;
  publicId: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  updatedAt: Date;
};

export type CompletedVerifiedUploadResult =
  | { kind: 'completed'; file: CompletedUploadFile }
  | { kind: 'not_found' }
  | { kind: 'expired' }
  | { kind: 'superseded' };

export type SaveUploadIntentCommand = {
  upload: UploadIntentInput;
  parentFolderId: string | null;
  fileName: string;
};

export type ExpirePendingIntentsCommand = {
  expiredAt: Date;
  limit: number;
};

export type AssertUploadTargetAvailableCommand = {
  userId: number;
  parentFolderId: string | null;
  fileName: string;
};

export type AssertReplacementTargetAvailableCommand = {
  userId: number;
  filePublicId: string;
};

export type SaveReplacementUploadIntentCommand = {
  upload: UploadIntentInput;
  filePublicId: string;
};

export interface UploadIntentRepository {
  findByUserAndUploadId(userId: number, uploadId: string): Promise<UploadIntent | null>;
  save(intent: SaveUploadIntentCommand): Promise<void>;
  completeVerifiedUpload(
    command: CompleteVerifiedUploadCommand,
  ): Promise<CompletedVerifiedUploadResult>;
  expirePendingIntents(command: ExpirePendingIntentsCommand): Promise<number>;
  assertUploadTargetAvailable(command: AssertUploadTargetAvailableCommand): Promise<void>;
  assertReplacementTargetAvailable(command: AssertReplacementTargetAvailableCommand): Promise<void>;
  saveReplacement(command: SaveReplacementUploadIntentCommand): Promise<void>;
}
