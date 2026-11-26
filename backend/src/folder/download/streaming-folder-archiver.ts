import { ZipArchive, type ZipEntryData } from 'archiver';
import { PassThrough, Readable } from 'node:stream';
import type { ObjectStorage } from '../../storage/object-storage.js';
import type {
  CreateFolderArchiveCommand,
  CreateFolderArchiveResult,
  FolderArchiver,
} from './folder-archiver.js';

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

    command.signal?.throwIfAborted();

    const internalController = new AbortController();
    const signal = command.signal
      ? AbortSignal.any([command.signal, internalController.signal])
      : internalController.signal;

    const uploadBody = new PassThrough();
    const archive = new ZipArchive({ forceZip64: true, store: true });
    let activeSource: Readable | null = null;

    const abortPipeline = (error: unknown) => {
      if (!internalController.signal.aborted) {
        internalController.abort(this.toError(error));
      }
    };

    const onAbort = () => {
      const abortError = this.toError(signal.reason);
      this.destroySource(activeSource);
      activeSource = null;
      if (!archive.destroyed) {
        archive.destroy(abortError);
      }
      if (!uploadBody.destroyed) {
        uploadBody.destroy(abortError);
      }
    };

    signal.addEventListener('abort', onAbort, { once: true });
    archive.on('error', abortPipeline);
    uploadBody.on('error', abortPipeline);
    archive.pipe(uploadBody);

    const uploadPromise = this.storage.uploadObjectStream({
      objectKey: command.archiveObjectKey,
      contentType: 'application/zip',
      body: uploadBody,
      signal,
    });
    uploadPromise.catch(abortPipeline);

    try {
      for (const { entry, path } of archiveEntries) {
        signal.throwIfAborted();

        if (entry.kind === 'folder') {
          await this.appendAndWait(
            archive,
            Buffer.alloc(0),
            {
              name: `${path}/`,
              type: 'directory',
            },
            signal,
          );
          continue;
        }

        const source = await this.storage.getObjectStream(entry.objectKey, signal);
        activeSource = source;
        signal.throwIfAborted();

        await this.appendAndWait(archive, source, { name: path, type: 'file' }, signal);
        activeSource = null;
      }

      signal.throwIfAborted();
      await Promise.all([archive.finalize(), uploadPromise]);

      return {
        sizeBytes: archive.pointer(),
      };
    } catch (error) {
      const normalizedError = signal.aborted ? this.toError(signal.reason) : this.toError(error);
      abortPipeline(normalizedError);
      this.destroySource(activeSource);
      activeSource = null;
      await uploadPromise.catch(() => undefined);
      throw normalizedError;
    } finally {
      signal.removeEventListener('abort', onAbort);
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
    signal?: AbortSignal,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        archive.off('entry', onEntry);
        archive.off('error', onError);
        archive.off('close', onClose);
        if (source instanceof Readable) {
          source.off('error', onError);
          source.off('close', onSourceClose);
        }
        signal?.removeEventListener('abort', onAbort);
      };

      const settleResolve = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve();
      };

      const settleReject = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error);
      };

      const onEntry = () => {
        settleResolve();
      };

      const onError = (error: Error) => {
        settleReject(error);
      };

      const onClose = () => {
        const error = signal?.aborted
          ? this.toError(signal.reason)
          : new Error('Folder archive stream closed before entry completed');
        settleReject(error);
      };

      const onSourceClose = () => {
        if (source instanceof Readable && !source.readableEnded) {
          const error =
            source.errored instanceof Error
              ? source.errored
              : new Error('Folder archive source stream closed before completing');
          settleReject(error);
        }
      };

      const onAbort = () => {
        settleReject(this.toError(signal!.reason));
      };

      if (signal?.aborted) {
        onAbort();
        return;
      }

      if (archive.destroyed || archive.closed) {
        onClose();
        return;
      }

      if (
        source instanceof Readable &&
        (source.destroyed || source.closed) &&
        !source.readableEnded
      ) {
        onSourceClose();
        return;
      }

      archive.once('entry', onEntry);
      archive.once('error', onError);
      archive.once('close', onClose);
      if (source instanceof Readable) {
        source.once('error', onError);
        source.once('close', onSourceClose);
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      archive.append(source, data);
    });
  }

  private destroySource(source: Readable | null): void {
    if (source === null || source.destroyed) {
      return;
    }

    if (source.listenerCount('error') === 0) {
      source.on('error', () => undefined);
    }

    source.destroy();
  }

  private toError(error: unknown): Error {
    return error instanceof Error
      ? error
      : new Error('Folder archive creation failed', { cause: error });
  }
}
