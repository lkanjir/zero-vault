import type { UploadIntent } from './upload-intent.js';

export type CompleteVerifiedUploadCommand = {
  userId: number;
  uploadId: string;
  objectKey: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  completedAt: Date;
};

export type CompletedUploadFile = {
  entryId: number;
  publicId: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  status: 'quarantined';
};

export interface UploadIntentRepository {
  findByUserAndUploadId(userId: number, uploadId: string): Promise<UploadIntent | null>;
  save(intent: Omit<UploadIntent, 'id'>): Promise<void>;
  markedExpiredIfPending(createdByUserId: number, uploadId: string): Promise<UploadIntent | null>;
  completeVerifiedUpload(
    command: CompleteVerifiedUploadCommand,
  ): Promise<CompletedUploadFile | null>;
}
