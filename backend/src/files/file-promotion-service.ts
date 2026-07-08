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

  async promoteFile(entryId: number): Promise<File> {
    const file = await this.repo.findByEntryId(entryId);

    if (!file) {
      throw new NotFoundError('Quarantined file not found');
    }

    if (file.status === 'available') {
      this.tryDeleteQuarantinedObject(file);
      return file;
    }

    if (file.status === 'rejected') {
      throw new ConflictError('File is rejected');
    }

    const quarantinedObject = await this.storage.headObject('quarantine', file.objectKey);
    this.assertObjectsMatch(quarantinedObject, file);

    await this.storage.copyObject('quarantine', 'live', file.objectKey);

    const liveObject = await this.storage.headObject('live', file.objectKey);
    this.assertObjectsMatch(liveObject, file);

    const promotedFile = await this.repo.markAvailable(file.entryId);

    if (promotedFile) {
      this.tryDeleteQuarantinedObject(file);
      return promotedFile;
    }

    const currentFile = await this.repo.findByEntryId(file.entryId);

    if (currentFile?.status === 'available') {
      this.tryDeleteQuarantinedObject(currentFile);
      return currentFile;
    }

    if (currentFile?.status === 'rejected') {
      throw new ConflictError('File is rejected');
    }

    throw new ConflictError('File is no longer quarantined');
  }

  private assertObjectsMatch(quarantinedObject: ObjectMetadata, file: File): void {
    if (!quarantinedObject.sha256Hex) {
      throw new ConflictError('Object has no SHA-256 checksum');
    }

    if (quarantinedObject.sizeBytes !== file.sizeBytes) {
      throw new ConflictError('Object size does not match file record');
    }

    if (quarantinedObject.contentType !== file.contentType) {
      throw new ConflictError('Object content type does not match file record');
    }

    if (quarantinedObject.sha256Hex !== file.sha256) {
      throw new ConflictError('Object checksum does not match file record');
    }
  }

  private tryDeleteQuarantinedObject(file: File): void {
    this.storage.deleteObject('quarantine', file.objectKey).catch((err: Error) => {
      console.error('Failed to delete promoted file from quarantine', {
        entryId: file.entryId,
        objectKey: file.objectKey,
        error: err,
      });
    });
  }
}
