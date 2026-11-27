import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom, from, lastValueFrom, mergeMap, Observable, toArray } from 'rxjs';
import { FileEntry } from '../../../data-access/entries/entry-models';
import { FolderApi } from '../../../data-access/folders/folder-api';
import { UploadApi } from '../../../data-access/uploads/upload-api';
import {
  MAX_UPLOAD_SIZE_BYTES,
  SINGLE_PART_MAX_BYTES,
} from '../../../data-access/uploads/upload-constraints';
import {
  CompletedUploadPart,
  UploadContentRequest,
  UploadIntentResponse,
} from '../../../data-access/uploads/upload-models';
import { apiErrorMessage, toApiError } from '../../../shared/api-error';
import { Result } from '../../../shared/result';
import { calculateSha256 } from '../../../shared/util/sha256';
import { FolderUploadBatch, FolderUploadFile } from '../folder-upload-scanner';
import {
  abortableLastValueFrom,
  isUploadCancelledError,
  UploadCancelledError,
  UploadExecutor,
} from '../upload-executor';
import {
  FileUploadTransfer,
  FolderTransferFileError,
  FolderUploadResult,
  FolderUploadTransfer,
  TransferFailure,
  TransferOperation,
  UploadTransfer,
} from './transfer-models';

type FailureContext = 'preparing' | 'presigning' | 'uploading' | 'finalizing';

const MAX_CONCURRENT_UPLOADS = 3;
const MAX_FOLDER_TREE_PATHS_PER_REQUEST = 1000;
const MAX_FOLDER_TREE_NODES_PER_REQUEST = 2000;
const TERMINAL_SERVER_ERROR_CODES = new Set([
  'upload_already_completed',
  'upload_aborted',
  'upload_expired',
  'upload_not_found',
  'duplicate_entry_name',
  'replacement_conflict',
]);

@Injectable({ providedIn: 'root' })
export class TransferStore {
  private readonly folderApi = inject(FolderApi);
  private readonly uploadApi = inject(UploadApi);
  private readonly uploadExecutor = inject(UploadExecutor);
  private readonly _transfers = signal<UploadTransfer[]>([]);
  private readonly _panelOpen = signal(false);
  private readonly activeControllers = new Map<string, AbortController>();
  private readonly activeUploadIdsByTransfer = new Map<string, Set<string>>();
  private readonly abortedUploadIds = new Set<string>();

  readonly transfers = this._transfers.asReadonly();
  readonly failedCount = computed(
    () => this._transfers().filter((transfer) => transfer.phase === 'failed').length,
  );
  readonly panelOpen = this._panelOpen.asReadonly();

  startUpload(
    file: File,
    targetParentId: string | null,
  ): Promise<Result<FileEntry, TransferFailure>> {
    return this.startTransfer(file, 'create', file.name, (content) =>
      this.uploadApi.createIntent({
        ...content,
        fileName: file.name,
        parentFolderId: targetParentId,
      }),
    );
  }

  startReplacement(file: File, targetFile: FileEntry): Promise<Result<FileEntry, TransferFailure>> {
    return this.startTransfer(file, 'replace', targetFile.name, (content) =>
      this.uploadApi.createReplaceIntent(targetFile.id, content),
    );
  }

  async startUploads(
    files: readonly File[],
    targetParentId: string | null,
  ): Promise<Result<FileEntry, TransferFailure>[]> {
    return lastValueFrom(
      from(files).pipe(
        mergeMap((file) => this.startUpload(file, targetParentId), MAX_CONCURRENT_UPLOADS),
        toArray(),
      ),
    );
  }

  async startFolderUpload(
    batch: FolderUploadBatch,
    targetParentId: string | null,
  ): Promise<FolderUploadResult> {
    if (batch.folderPaths.length === 0) {
      return {
        ok: true,
        createdFolders: false,
        completedFiles: 0,
        failedFiles: 0,
        cancelled: false,
        error: null,
      };
    }

    this._panelOpen.set(true);

    const transferId = crypto.randomUUID();
    const controller = new AbortController();
    const activeUploadIds = new Set<string>();
    this.activeControllers.set(transferId, controller);
    this.activeUploadIdsByTransfer.set(transferId, activeUploadIds);

    const totalSizeBytes = batch.files.reduce((sum, item) => sum + item.file.size, 0);

    const initialTransfer: FolderUploadTransfer = {
      kind: 'folder',
      id: transferId,
      folderName: batch.rootName,
      totalSizeBytes,
      uploadedBytes: 0,
      totalFiles: batch.files.length,
      completedFiles: 0,
      failedFiles: 0,
      totalFolders: batch.folderPaths.length,
      phase: 'preparing',
      progress: null,
      bytesPerSecond: null,
      error: null,
      fileErrors: [],
    };

    this._transfers.update((transfers) => [initialTransfer, ...transfers]);

    let createdFolders = false;
    let completedFiles = 0;
    let failedFiles = 0;
    let completedBytes = 0;
    const inFlightBytes = new Map<number, number>();
    const fileErrors: FolderTransferFileError[] = [];

    try {
      const folderMap = await this.ensureFolderTreeChunked(
        batch.folderPaths,
        targetParentId,
        controller.signal,
        () => {
          createdFolders = true;
        },
      );

      if (controller.signal.aborted) {
        throw new UploadCancelledError();
      }

      if (batch.files.length === 0) {
        this.patchFolderTransfer(transferId, {
          phase: 'completed',
          progress: 100,
          bytesPerSecond: null,
        });

        return {
          ok: true,
          createdFolders: true,
          completedFiles: 0,
          failedFiles: 0,
          cancelled: false,
          error: null,
        };
      }

      const uploadStartedAt = performance.now();
      this.patchFolderTransfer(transferId, {
        phase: 'uploading',
        progress: 0,
      });

      const reportAggregateProgress = () => {
        if (controller.signal.aborted) {
          return;
        }

        let activeBytes = 0;
        for (const loaded of inFlightBytes.values()) {
          activeBytes += loaded;
        }

        const uploadedBytes = Math.min(totalSizeBytes, completedBytes + activeBytes);
        const processedFiles = completedFiles + failedFiles;
        const progress =
          totalSizeBytes > 0
            ? Math.min(100, Math.round((uploadedBytes / totalSizeBytes) * 100))
            : Math.min(100, Math.round((processedFiles / batch.files.length) * 100));
        const elapsedSeconds = Math.max((performance.now() - uploadStartedAt) / 1000, 0.001);

        this.patchFolderTransfer(transferId, {
          uploadedBytes,
          completedFiles,
          failedFiles,
          progress,
          bytesPerSecond: uploadedBytes > 0 ? uploadedBytes / elapsedSeconds : null,
          fileErrors: [...fileErrors],
        });
      };

      let nextIndex = 0;
      const workerCount = Math.min(MAX_CONCURRENT_UPLOADS, batch.files.length);

      const runWorker = async () => {
        while (!controller.signal.aborted) {
          const currentIndex = nextIndex;
          nextIndex += 1;
          if (currentIndex >= batch.files.length) {
            return;
          }

          const item = batch.files[currentIndex];
          const resolvedParentId = folderMap.get(item.folderPath);

          if (resolvedParentId === undefined) {
            failedFiles += 1;
            fileErrors.push({
              relativePath: item.relativePath,
              fileName: item.file.name,
              code: 'folder_not_found',
              message: 'Odredišni direktorij nije pronađen.',
            });
            reportAggregateProgress();
            continue;
          }

          const outcome = await this.uploadFolderFile({
            item,
            parentFolderId: resolvedParentId,
            signal: controller.signal,
            activeUploadIds,
            onLoadedBytes: (loadedBytes) => {
              inFlightBytes.set(currentIndex, Math.min(loadedBytes, item.file.size));
              reportAggregateProgress();
            },
          });

          inFlightBytes.delete(currentIndex);

          if (outcome.kind === 'cancelled') {
            return;
          }

          if (outcome.kind === 'completed') {
            completedFiles += 1;
            completedBytes += item.file.size;
            reportAggregateProgress();
          } else {
            failedFiles += 1;
            fileErrors.push({
              relativePath: item.relativePath,
              fileName: item.file.name,
              code: outcome.failure.code,
              message: outcome.failure.message,
            });
            reportAggregateProgress();
          }
        }
      };

      await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

      if (controller.signal.aborted) {
        throw new UploadCancelledError();
      }

      if (failedFiles > 0) {
        const summaryError: TransferFailure = {
          status: -1,
          code: 'folder_upload_partial_failure',
          message:
            failedFiles === batch.files.length
              ? 'Prijenos direktorija nije uspio.'
              : 'Neke datoteke nisu prenesene.',
        };

        this.patchFolderTransfer(transferId, {
          phase: 'failed',
          bytesPerSecond: null,
          completedFiles,
          failedFiles,
          error: summaryError,
          fileErrors: [...fileErrors],
        });

        return {
          ok: false,
          createdFolders,
          completedFiles,
          failedFiles,
          cancelled: false,
          error: summaryError,
        };
      }

      this.patchFolderTransfer(transferId, {
        phase: 'completed',
        progress: 100,
        uploadedBytes: totalSizeBytes,
        completedFiles,
        failedFiles: 0,
        bytesPerSecond: null,
        error: null,
        fileErrors: [],
      });

      return {
        ok: true,
        createdFolders,
        completedFiles,
        failedFiles: 0,
        cancelled: false,
        error: null,
      };
    } catch (error) {
      if (isUploadCancelledError(error) || controller.signal.aborted) {
        for (const uploadId of activeUploadIds) {
          this.abortUploadBestEffort(uploadId);
        }

        this.patchFolderTransfer(transferId, {
          phase: 'cancelled',
          completedFiles,
          failedFiles,
          bytesPerSecond: null,
          error: null,
        });

        return {
          ok: false,
          createdFolders,
          completedFiles,
          failedFiles,
          cancelled: true,
          error: {
            status: -1,
            code: 'upload_cancelled',
            message: 'Prijenos je otkazan.',
          },
        };
      }

      const apiError = toApiError(error);
      const failure: TransferFailure = {
        ...apiError,
        message: apiErrorMessage(apiError, 'Kreiranje strukture direktorija nije uspjelo.'),
      };

      this.patchFolderTransfer(transferId, {
        phase: 'failed',
        bytesPerSecond: null,
        error: failure,
      });

      return {
        ok: false,
        createdFolders,
        completedFiles,
        failedFiles,
        cancelled: false,
        error: failure,
      };
    } finally {
      this.activeControllers.delete(transferId);
      this.activeUploadIdsByTransfer.delete(transferId);
      for (const uploadId of activeUploadIds) {
        this.abortedUploadIds.delete(uploadId);
      }
    }
  }

  cancelTransfer(transferId: string): void {
    const transfer = this._transfers().find((item) => item.id === transferId);
    if (!transfer || (transfer.phase !== 'preparing' && transfer.phase !== 'uploading')) {
      return;
    }

    this.patchTransfer(transferId, {
      phase: 'cancelled',
      bytesPerSecond: null,
      error: null,
    });

    this.activeControllers.get(transferId)?.abort();

    if (transfer.kind === 'file' && transfer.uploadId !== null) {
      this.abortUploadBestEffort(transfer.uploadId);
    }

    const activeUploadIds = this.activeUploadIdsByTransfer.get(transferId);
    if (activeUploadIds) {
      for (const uploadId of activeUploadIds) {
        this.abortUploadBestEffort(uploadId);
      }
    }
  }

  clearFinished(): void {
    this._transfers.update((transfers) =>
      transfers.filter(
        (transfer) =>
          transfer.phase !== 'completed' &&
          transfer.phase !== 'failed' &&
          transfer.phase !== 'cancelled',
      ),
    );
  }

  private async ensureFolderTreeChunked(
    folderPaths: readonly string[],
    targetParentId: string | null,
    signal: AbortSignal,
    onChunkSucceeded: () => void,
  ): Promise<Map<string, string>> {
    const folderMap = new Map<string, string>();
    const chunks = chunkFolderTreePaths(folderPaths);

    for (const chunk of chunks) {
      const response = await abortableLastValueFrom(
        this.folderApi.ensureFolderTree({
          parentId: targetParentId,
          paths: chunk,
        }),
        signal,
      );

      onChunkSucceeded();
      for (const [relativePath, folderId] of Object.entries(response.folders)) {
        folderMap.set(relativePath, folderId);
      }
    }

    return folderMap;
  }

  private async uploadFolderFile(params: {
    item: FolderUploadFile;
    parentFolderId: string;
    signal: AbortSignal;
    activeUploadIds: Set<string>;
    onLoadedBytes: (loadedBytes: number) => void;
  }): Promise<
    { kind: 'completed' } | { kind: 'cancelled' } | { kind: 'failed'; failure: TransferFailure }
  > {
    const { item, parentFolderId, signal, activeUploadIds, onLoadedBytes } = params;
    const { file } = item;

    if (signal.aborted) {
      return { kind: 'cancelled' };
    }

    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      return {
        kind: 'failed',
        failure: {
          status: -1,
          code: 'file_too_large',
          message: 'Datoteka ne može biti veća od 512 GB.',
        },
      };
    }

    let failureContext: FailureContext = 'preparing';
    let createdUploadId: string | null = null;

    try {
      const contentType = file.type.trim() || 'application/octet-stream';
      const isSinglePart = file.size <= SINGLE_PART_MAX_BYTES;
      const sha256 = isSinglePart ? await calculateSha256(file) : undefined;

      if (signal.aborted) {
        throw new UploadCancelledError();
      }

      failureContext = 'presigning';
      const intent = await abortableLastValueFrom(
        this.uploadApi.createIntent({
          contentType,
          size: file.size,
          ...(sha256 !== undefined ? { sha256 } : {}),
          fileName: file.name,
          parentFolderId,
          conflictStrategy: 'rename',
        }),
        signal,
      );

      createdUploadId = intent.uploadId;
      activeUploadIds.add(intent.uploadId);

      if (signal.aborted) {
        this.abortUploadBestEffort(intent.uploadId);
        throw new UploadCancelledError();
      }

      failureContext = 'uploading';
      let completedParts: CompletedUploadPart[] | undefined;

      if (intent.uploadMode === 'single') {
        await this.uploadExecutor.uploadSinglePart({
          file,
          intent,
          signal,
          onProgress: () => undefined,
          onLoadedBytes: (loadedBytes) => {
            if (!signal.aborted) {
              onLoadedBytes(loadedBytes);
            }
          },
        });
      } else {
        completedParts = await this.uploadExecutor.uploadMultipart({
          file,
          intent,
          signal,
          onProgress: () => undefined,
          onLoadedBytes: (loadedBytes) => {
            if (!signal.aborted) {
              onLoadedBytes(loadedBytes);
            }
          },
        });
      }

      if (signal.aborted) {
        this.abortUploadBestEffort(intent.uploadId);
        throw new UploadCancelledError();
      }

      failureContext = 'finalizing';
      await firstValueFrom(
        this.uploadApi.complete(
          intent.uploadId,
          completedParts !== undefined ? { parts: completedParts } : undefined,
        ),
      );

      return { kind: 'completed' };
    } catch (error) {
      if (isUploadCancelledError(error) || signal.aborted) {
        if (createdUploadId !== null) {
          this.abortUploadBestEffort(createdUploadId);
        }

        return { kind: 'cancelled' };
      }

      const failure = this.mapFailure(error, failureContext);

      if (createdUploadId !== null && !TERMINAL_SERVER_ERROR_CODES.has(failure.code)) {
        this.abortUploadBestEffort(createdUploadId);
      }

      return { kind: 'failed', failure };
    } finally {
      if (createdUploadId !== null) {
        activeUploadIds.delete(createdUploadId);
        this.abortedUploadIds.delete(createdUploadId);
      }
    }
  }

  private async startTransfer(
    file: File,
    operation: TransferOperation,
    displayName: string,
    createIntent: (content: UploadContentRequest) => Observable<UploadIntentResponse>,
  ): Promise<Result<FileEntry, TransferFailure>> {
    this._panelOpen.set(true);

    const transferId = crypto.randomUUID();
    const contentType = file.type.trim() || 'application/octet-stream';
    const controller = new AbortController();
    this.activeControllers.set(transferId, controller);

    const initialTransfer: FileUploadTransfer = {
      kind: 'file',
      id: transferId,
      uploadId: null,
      operation,
      fileName: displayName,
      sizeBytes: file.size,
      phase: 'preparing',
      progress: null,
      bytesPerSecond: null,
      error: null,
    };

    this._transfers.update((transfers) => [initialTransfer, ...transfers]);

    let failureContext: FailureContext = 'preparing';
    let createdUploadId: string | null = null;

    try {
      if (file.size > MAX_UPLOAD_SIZE_BYTES) {
        const failure: TransferFailure = {
          status: -1,
          code: 'file_too_large',
          message: 'Datoteka ne može biti veća od 512 GB.',
        };

        this.patchFileTransfer(transferId, {
          phase: 'failed',
          error: failure,
        });

        return {
          ok: false,
          error: failure,
        };
      }

      const isSinglePart = file.size <= SINGLE_PART_MAX_BYTES;
      const sha256 = isSinglePart ? await calculateSha256(file) : undefined;
      if (controller.signal.aborted) {
        throw new UploadCancelledError();
      }

      failureContext = 'presigning';
      const content: UploadContentRequest = {
        contentType,
        size: file.size,
        ...(sha256 !== undefined ? { sha256 } : {}),
      };

      const intent = await abortableLastValueFrom(createIntent(content), controller.signal);
      createdUploadId = intent.uploadId;

      if (controller.signal.aborted) {
        this.abortUploadBestEffort(intent.uploadId);
        throw new UploadCancelledError();
      }

      this.patchFileTransfer(transferId, {
        uploadId: intent.uploadId,
        phase: 'uploading',
        progress: 0,
      });
      failureContext = 'uploading';

      let completedParts: CompletedUploadPart[] | undefined;

      if (intent.uploadMode === 'single') {
        await this.uploadExecutor.uploadSinglePart({
          file,
          intent,
          signal: controller.signal,
          onProgress: (snapshot) => {
            if (controller.signal.aborted) {
              return;
            }
            this.patchFileTransfer(transferId, {
              progress: snapshot.progress,
              bytesPerSecond: snapshot.bytesPerSecond,
            });
          },
        });
      } else {
        completedParts = await this.uploadExecutor.uploadMultipart({
          file,
          intent,
          signal: controller.signal,
          onProgress: (snapshot) => {
            if (controller.signal.aborted) {
              return;
            }
            this.patchFileTransfer(transferId, {
              progress: snapshot.progress,
              bytesPerSecond: snapshot.bytesPerSecond,
            });
          },
        });
      }

      if (controller.signal.aborted) {
        this.abortUploadBestEffort(intent.uploadId);
        throw new UploadCancelledError();
      }

      failureContext = 'finalizing';
      this.patchFileTransfer(transferId, {
        phase: 'finalizing',
        progress: 100,
        bytesPerSecond: null,
      });

      const completed = await firstValueFrom(
        this.uploadApi.complete(
          intent.uploadId,
          completedParts !== undefined ? { parts: completedParts } : undefined,
        ),
      );
      this.patchFileTransfer(transferId, {
        phase: 'completed',
        bytesPerSecond: null,
        progress: 100,
      });
      return { ok: true, value: completed };
    } catch (error) {
      if (isUploadCancelledError(error) || controller.signal.aborted) {
        if (createdUploadId !== null) {
          this.abortUploadBestEffort(createdUploadId);
        }

        this.patchFileTransfer(transferId, {
          phase: 'cancelled',
          bytesPerSecond: null,
          error: null,
        });

        return {
          ok: false,
          error: {
            status: -1,
            code: 'upload_cancelled',
            message: 'Prijenos je otkazan.',
          },
        };
      }

      const failure = this.mapFailure(error, failureContext);

      if (createdUploadId !== null && !TERMINAL_SERVER_ERROR_CODES.has(failure.code)) {
        this.abortUploadBestEffort(createdUploadId);
      }

      this.patchFileTransfer(transferId, {
        phase: 'failed',
        bytesPerSecond: null,
        error: failure,
      });

      return { ok: false, error: failure };
    } finally {
      this.activeControllers.delete(transferId);
      if (createdUploadId !== null) {
        this.abortedUploadIds.delete(createdUploadId);
      }
    }
  }

  private abortUploadBestEffort(uploadId: string): void {
    if (this.abortedUploadIds.has(uploadId)) {
      return;
    }

    this.abortedUploadIds.add(uploadId);
    this.uploadApi.abort(uploadId).subscribe({
      error: () => undefined,
    });
  }

  private patchTransfer(
    transferId: string,
    changes: Partial<Pick<UploadTransfer, 'phase' | 'progress' | 'bytesPerSecond' | 'error'>>,
  ): void {
    this._transfers.update((transfers) =>
      transfers.map((transfer) =>
        transfer.id === transferId ? { ...transfer, ...changes } : transfer,
      ),
    );
  }

  private patchFileTransfer(transferId: string, changes: Partial<FileUploadTransfer>): void {
    this._transfers.update((transfers) =>
      transfers.map((transfer) =>
        transfer.id === transferId && transfer.kind === 'file'
          ? { ...transfer, ...changes }
          : transfer,
      ),
    );
  }

  private patchFolderTransfer(transferId: string, changes: Partial<FolderUploadTransfer>): void {
    this._transfers.update((transfers) =>
      transfers.map((transfer) =>
        transfer.id === transferId && transfer.kind === 'folder'
          ? { ...transfer, ...changes }
          : transfer,
      ),
    );
  }

  private mapFailure(cause: unknown, context: FailureContext): TransferFailure {
    const error = toApiError(cause);

    if (error.code === 'duplicate_entry_name') {
      return {
        ...error,
        message: 'Datoteka s tim nazivom već postoji u ovom direktoriju.',
      };
    }

    const fallback = {
      preparing: 'Greška pripreme prijenosa',
      presigning: 'Prijenos ne može početi.',
      uploading: 'Prijenos nije uspio.',
      finalizing: 'Greška pri završavanju.',
    }[context];

    const message =
      context === 'uploading'
        ? error.message
          ? apiErrorMessage(error, fallback)
          : fallback
        : apiErrorMessage(error, fallback);

    return { ...error, message };
  }

  togglePanel(): void {
    this._panelOpen.update((open) => !open);
  }

  closePanel(): void {
    this._panelOpen.set(false);
  }
}

function reduceToLeafFolderPaths(folderPaths: readonly string[]): string[] {
  const uniquePaths = Array.from(new Set(folderPaths));
  const parentPrefixes = new Set<string>();

  for (const path of uniquePaths) {
    let slashIndex = path.lastIndexOf('/');
    while (slashIndex > 0) {
      const prefix = path.slice(0, slashIndex);
      if (parentPrefixes.has(prefix)) {
        break;
      }
      parentPrefixes.add(prefix);
      slashIndex = prefix.lastIndexOf('/');
    }
  }

  return uniquePaths.filter((path) => !parentPrefixes.has(path));
}

function expandCanonicalNodes(relativePath: string): string[] {
  const segments = relativePath.split('/').map((segment) => segment.trim().toLowerCase());
  const nodes: string[] = [];

  for (let depth = 1; depth <= segments.length; depth += 1) {
    nodes.push(segments.slice(0, depth).join('/'));
  }

  return nodes;
}

function chunkFolderTreePaths(folderPaths: readonly string[]): string[][] {
  const requestPaths = reduceToLeafFolderPaths(folderPaths);
  const chunks: string[][] = [];
  let currentChunk: string[] = [];
  let currentNodes = new Set<string>();

  for (const path of requestPaths) {
    const pathNodes = expandCanonicalNodes(path);
    let additionalNodes = 0;
    for (const node of pathNodes) {
      if (!currentNodes.has(node)) {
        additionalNodes += 1;
      }
    }

    if (
      currentChunk.length > 0 &&
      (currentChunk.length >= MAX_FOLDER_TREE_PATHS_PER_REQUEST ||
        currentNodes.size + additionalNodes > MAX_FOLDER_TREE_NODES_PER_REQUEST)
    ) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentNodes = new Set<string>();
    }

    currentChunk.push(path);
    for (const node of pathNodes) {
      currentNodes.add(node);
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}
