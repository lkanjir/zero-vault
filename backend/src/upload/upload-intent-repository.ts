import type { UploadIntent } from './upload-intent.js';

export interface UploadIntentRepository {
  findByUploadId(uploadId: string): Promise<UploadIntent | null>;
  save(intent: UploadIntent): Promise<void>;
  update(intent: UploadIntent): Promise<void>;
  deleteByUploadId(uploadId: string): Promise<boolean>;
}
