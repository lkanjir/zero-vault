import { clamp } from '../../shared/utils/clamp.js';
import type { FolderDownloadRepository } from './folder-download-repository.js';

export class FolderDownloadCleanupService {
  constructor(private readonly repository: FolderDownloadRepository) {}

  async cleanExpiredDownloads(limit: number): Promise<number> {
    return this.repository.expireReadyFolderDownloads({
      expiredAt: new Date(),
      limit: clamp(limit, 1, 1000),
    });
  }
}
