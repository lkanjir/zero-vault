import { ZipArchive, type ZipEntryData } from 'archiver';
import type { ObjectStorage } from '../../storage/object-storage.js';
import type {
  CreateFolderArchiveCommand,
  CreateFolderArchiveResult,
  FolderArchiver,
} from './folder-archiver.js';
import { PassThrough, type Readable } from 'node:stream';

export class StreamingFolderArchiver implements FolderArchiver {
  constructor(private readonly storage: ObjectStorage) {}

  async create(command: CreateFolderArchiveCommand): Promise<CreateFolderArchiveResult> {
    if (command.entries.length === 0) {
      throw new Error('Folder archive manifest is empty');
    }

    const archiveEntries = command.entries.map((entry) => ({
      entry,
      path: this.toArchivePath(entry.pathParts),
    }));

    const uploadBody = new PassThrough();
    const archive = new ZipArchive({ forceZip64: true, store: true });
    archive.pipe(uploadBody);

    const uploadPromise = this.storage.uploadObjectStream({
      objectKey: command.archiveObjectKey,
      contentType: 'application/zip',
      body: uploadBody,
    });

    uploadPromise.catch((error) => archive.destroy(this.toError(error)));

    try {
      for (const { entry, path } of archiveEntries) {
        if (entry.kind === 'folder') {
          await this.appendAndWait(archive, Buffer.alloc(0), {
            name: `${path}/`,
            type: 'directory',
          });
          continue;
        }

        const source = await this.storage.getObjectStream(entry.objectKey);
        await this.appendAndWait(archive, source, { name: path, type: 'file' });
      }

      await Promise.all([archive.finalize(), uploadPromise]);

      return {
        sizeBytes: archive.pointer(),
      };
    } catch (error) {
      const normalizedError = this.toError(error);

      archive.destroy();
      uploadBody.destroy();

      await uploadPromise.catch(() => undefined);
      throw normalizedError;
    }
  }

  private toArchivePath(pathParts: string[]): string {
    const invalid = pathParts.some(
      (part) =>
        part.length === 0 ||
        part === '.' ||
        part === '..' ||
        part.includes('/') ||
        part.includes('\\') ||
        part.includes('\0'),
    );

    if (pathParts.length === 0 || invalid) {
      throw new Error('Folder archive entry has an invalid path');
    }

    return pathParts.join('/');
  }

  private appendAndWait(
    archive: ZipArchive,
    source: Readable | Buffer,
    data: ZipEntryData,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        archive.off('entry', onEntry);
        archive.off('error', onError);
      };

      const onEntry = () => {
        cleanup();
        resolve();
      };

      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };

      archive.once('entry', onEntry);
      archive.once('error', onError);
      archive.append(source, data);
    });
  }

  private toError(error: unknown): Error {
    return error instanceof Error
      ? error
      : new Error('Folder archive creation failed', { cause: error });
  }
}
