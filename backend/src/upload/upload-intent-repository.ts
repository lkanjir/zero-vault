import type { UploadIntent } from './upload-intent.js';

export interface UploadIntentRepository {
  findByUserAndUploadId(userId: number, uploadId: string): Promise<UploadIntent | null>;
  save(intent: UploadIntent): Promise<void>;
  update(intent: UploadIntent): Promise<boolean>;
  // deleteByUploadId(uploadId: string): Promise<boolean>;
}
