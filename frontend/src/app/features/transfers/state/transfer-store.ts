import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom, from, lastValueFrom, mergeMap, Observable, toArray } from 'rxjs';
import { FileEntry } from '../../../data-access/entries/entry-models';
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
import {
  abortableLastValueFrom,
  isUploadCancelledError,
  UploadCancelledError,
  UploadExecutor,
} from '../upload-executor';
import { TransferFailure, TransferOperation, UploadTransfer } from './transfer-models';

type FailureContext = 'preparing' | 'presigning' | 'uploading' | 'finalizing';

const MAX_CONCURRENT_UPLOADS = 3;
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
  private readonly uploadApi = inject(UploadApi);
  private readonly uploadExecutor = inject(UploadExecutor);
  private readonly _transfers = signal<UploadTransfer[]>([]);
  private readonly _panelOpen = signal(false);
  private readonly activeControllers = new Map<string, AbortController>();
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

  cancelTransfer(transferId: string): void {
    const transfer = this._transfers().find((item) => item.id === transferId);
    if (!transfer || (transfer.phase !== 'preparing' && transfer.phase !== 'uploading')) {
      return;
    }

    this.patch(transferId, {
      phase: 'cancelled',
      bytesPerSecond: null,
      error: null,
    });

    this.activeControllers.get(transferId)?.abort();

    if (transfer.uploadId !== null) {
      this.abortUploadBestEffort(transfer.uploadId);
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

    this._transfers.update((transfers) => [
      {
        id: transferId,
        uploadId: null,
        operation,
        fileName: displayName,
        sizeBytes: file.size,
        phase: 'preparing',
        progress: null,
        bytesPerSecond: null,
        error: null,
      },
      ...transfers,
    ]);

    let failureContext: FailureContext = 'preparing';
    let createdUploadId: string | null = null;

    try {
      if (file.size > MAX_UPLOAD_SIZE_BYTES) {
        const failure: TransferFailure = {
          status: -1,
          code: 'file_too_large',
          message: 'Datoteka ne može biti veća od 512 GB.',
        };

        this.patch(transferId, {
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

      this.patch(transferId, { uploadId: intent.uploadId, phase: 'uploading', progress: 0 });
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
            this.patch(transferId, {
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
            this.patch(transferId, {
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
      this.patch(transferId, {
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
      this.patch(transferId, { phase: 'completed', bytesPerSecond: null, progress: 100 });
      return { ok: true, value: completed };
    } catch (error) {
      if (isUploadCancelledError(error) || controller.signal.aborted) {
        if (createdUploadId !== null) {
          this.abortUploadBestEffort(createdUploadId);
        }

        this.patch(transferId, {
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

      this.patch(transferId, { phase: 'failed', bytesPerSecond: null, error: failure });

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

  private patch(transferId: string, changes: Partial<UploadTransfer>): void {
    this._transfers.update((transfers) =>
      transfers.map((transfer) =>
        transfer.id === transferId ? { ...transfer, ...changes } : transfer,
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
