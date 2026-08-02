import { clamp } from '../shared/utils/clamp.js';
import type { FileGrantMaintenanceResult, FileGrantRepository } from './file-grant-repository.js';

export class FileGrantMaintenanceService {
  constructor(private readonly repository: FileGrantRepository) {}

  maintainPendingGrants(limit: number): Promise<FileGrantMaintenanceResult> {
    return this.repository.maintainPending({
      processedAt: new Date(),
      limit: clamp(limit, 1, 1000),
    });
  }
}
