import type { UploadIntent } from './upload-intent.js';

export interface UploadIntentRepository {
  findById(id: string): Promise<UploadIntent | null>;
  save(intent: UploadIntent): Promise<void>;
  update(intent: UploadIntent): Promise<void>;
  deleteById(id: string): Promise<boolean>;
}
