import type { FileStatus } from '../files/file.js';
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
  status: FileStatus;
};

export type CompletedVerifiedUploadResult =
  | { kind: 'completed'; file: CompletedUploadFile }
  | { kind: 'not_found' }
  | { kind: 'not_pending' };

export interface UploadIntentRepository {
  findByUserAndUploadId(userId: number, uploadId: string): Promise<UploadIntent | null>;
  save(intent: Omit<UploadIntent, 'id'>): Promise<void>;
  markExpiredIfPending(createdByUserId: number, uploadId: string): Promise<UploadIntent | null>;
  completeVerifiedUpload(
    command: CompleteVerifiedUploadCommand,
  ): Promise<CompletedVerifiedUploadResult>;
}
