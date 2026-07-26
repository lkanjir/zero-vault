import { clamp } from '../shared/utils/clamp.js';
import type { UploadIntentRepository } from './upload-intent-repository.js';

export class UploadCleanupService {
  constructor(private readonly repo: UploadIntentRepository) {}

  async cleanExpiredUploads(limit: number): Promise<number> {
    return this.repo.expirePendingIntents({ expiredAt: new Date(), limit: clamp(limit, 1, 1000) });
  }
}
