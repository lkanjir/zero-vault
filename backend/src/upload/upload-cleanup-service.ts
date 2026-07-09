import { clamp } from '../shared/utils/clamp.js';
import type { ObjectStorage } from '../storage/object-storage.js';
import type { UploadIntentRepository } from './upload-intent-repository.js';

export class UploadCleanupService {
  constructor(
    private readonly repo: UploadIntentRepository,
    private readonly storage: ObjectStorage,
  ) {}

  async cleanExpiredUploads(now: Date, limit: number): Promise<void> {
    limit = clamp(limit, 1, 1000);

    const expired = await this.repo.markExpiredIntents(now, limit);
    const failed = await this.storage.deleteObjects(expired.map((e) => e.objectKey));

    if (failed.length != 0) {
      console.error('Failed to delte expired expired objects', {
        failedKeys: failed,
      });
    }
  }
}
