import type { UploadIntent } from './upload-intent.js';

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
  | { kind: 'expired' };

export type SaveUploadIntentCommand = Omit<UploadIntent, 'id' | 'targetParentId'> & {
  parentFolderId: string | null;
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

export interface UploadIntentRepository {
  findByUserAndUploadId(userId: number, uploadId: string): Promise<UploadIntent | null>;
  save(intent: SaveUploadIntentCommand): Promise<void>;
  completeVerifiedUpload(
    command: CompleteVerifiedUploadCommand,
  ): Promise<CompletedVerifiedUploadResult>;
  expirePendingIntents(command: ExpirePendingIntentsCommand): Promise<number>;
  assertUploadTargetAvailable(command: AssertUploadTargetAvailableCommand): Promise<void>;
}
