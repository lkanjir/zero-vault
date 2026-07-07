import { ConflictError } from '../shared/errors/conflict-error.js';
import { NotFoundError } from '../shared/errors/not-found-error.js';
import type { ObjectMetadata, ObjectStorage } from '../storage/object-storage.js';
import type { FileRepository } from './file-repository.js';
import type { File } from './file.js';

export class FilePromotionService {
  constructor(
    private readonly repo: FileRepository,
    private readonly storage: ObjectStorage,
  ) {}

  async promoteFile(entryId: number): Promise<void> {
    const file = await this.repo.findQuarantinedByEntryId(entryId);

    if (!file) {
      throw new NotFoundError('Quarantined file not found');
    }

    const quarantinedObject = await this.storage.headObject('quarantine', file.objectKey);
    this.verifyObjectsMatch(quarantinedObject, file);

    await this.storage.copyObject('quarantine', 'live', file.objectKey);

    const liveObject = await this.storage.headObject('live', file.objectKey);
    this.verifyObjectsMatch(liveObject, file);

    const promotedFile = await this.repo.markAvailable(file.entryId);

    if (!promotedFile) {
      throw new ConflictError('File is no longer quarantined');
    }
  }

  verifyObjectsMatch(quarantinedObject: ObjectMetadata, file: File): boolean {
    return (
      quarantinedObject.size !== file.sizeBytes ||
      quarantinedObject.contentType !== file.contentType ||
      quarantinedObject.sha256Hex != file.sha256
    );
  }
}
