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

    if (command.signal?.aborted) {
      throw this.toAbortError(command.signal);
    }

    const pipelineController = new AbortController();
    const uploadBody = new PassThrough();
    const archive = new ZipArchive({ forceZip64: true, store: true });
    let activeSource: Readable | null = null;
    const streamState: { error: Error | null } = { error: null };
    const getStreamError = (): Error | null => streamState.error;

    archive.on('error', (error: Error) => {
      streamState.error ??= error;
    });
    uploadBody.on('error', (error: Error) => {
      streamState.error ??= error;
    });
    archive.pipe(uploadBody);

    const onExternalAbort = () => {
      const abortError = this.toAbortError(command.signal!);
      streamState.error ??= abortError;
      pipelineController.abort(abortError);
    };

    const onPipelineAbort = () => {
      const abortError = this.toAbortError(pipelineController.signal);
      this.destroySource(activeSource);
      activeSource = null;
      if (!archive.destroyed) {
        archive.destroy(abortError);
      }
      if (!uploadBody.destroyed) {
        uploadBody.destroy(abortError);
      }
    };

    pipelineController.signal.addEventListener('abort', onPipelineAbort, { once: true });
    command.signal?.addEventListener('abort', onExternalAbort, { once: true });

    const uploadPromise = this.storage.uploadObjectStream({
      objectKey: command.archiveObjectKey,
      contentType: 'application/zip',
      body: uploadBody,
      signal: pipelineController.signal,
    });

    uploadPromise.catch((error) => {
      const normalized = this.toError(error);
      streamState.error ??= normalized;
      if (!pipelineController.signal.aborted) {
        pipelineController.abort(normalized);
      }
    });

    try {
      for (const { entry, path } of archiveEntries) {
        if (command.signal?.aborted) {
          throw this.toAbortError(command.signal);
        }

        const pendingStreamError = getStreamError();
        if (pendingStreamError !== null) {
          throw pendingStreamError;
        }

        if (entry.kind === 'folder') {
          await this.appendAndWait(
            archive,
            Buffer.alloc(0),
            {
              name: `${path}/`,
              type: 'directory',
            },
            pipelineController.signal,
          );
          continue;
        }

        const source = await this.storage.getObjectStream(
          entry.objectKey,
          pipelineController.signal,
        );
        activeSource = source;

        if (command.signal?.aborted) {
          throw this.toAbortError(command.signal);
        }

        const streamErrorAfterOpen = getStreamError();
        if (streamErrorAfterOpen !== null) {
          throw streamErrorAfterOpen;
        }

        await this.appendAndWait(
          archive,
          source,
          { name: path, type: 'file' },
          pipelineController.signal,
        );
        activeSource = null;
      }

      if (command.signal?.aborted) {
        throw this.toAbortError(command.signal);
      }

      await Promise.all([archive.finalize(), uploadPromise]);

      return {
        sizeBytes: archive.pointer(),
      };
    } catch (error) {
      const normalizedError = command.signal?.aborted
        ? this.toAbortError(command.signal)
        : (getStreamError() ?? this.toError(error));

      if (!pipelineController.signal.aborted) {
        pipelineController.abort(normalizedError);
      }

      this.destroySource(activeSource);
      activeSource = null;
      if (!archive.destroyed) {
        archive.destroy(normalizedError);
      }
      if (!uploadBody.destroyed) {
        uploadBody.destroy(normalizedError);
      }

      await uploadPromise.catch(() => undefined);
      throw normalizedError;
    } finally {
      command.signal?.removeEventListener('abort', onExternalAbort);
      pipelineController.signal.removeEventListener('abort', onPipelineAbort);
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
          ? this.toAbortError(signal)
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
        settleReject(this.toAbortError(signal!));
      };

      if (signal?.aborted) {
        settleReject(this.toAbortError(signal));
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

  private toAbortError(signal: AbortSignal): Error {
    if (signal.reason instanceof Error) {
      return signal.reason;
    }

    const error = new Error('Folder archive creation aborted', { cause: signal.reason });
    error.name = 'AbortError';
    return error;
  }

  private toError(error: unknown): Error {
    return error instanceof Error
      ? error
      : new Error('Folder archive creation failed', { cause: error });
  }
}
