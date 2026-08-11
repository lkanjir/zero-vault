import { computed, inject, Injectable, signal } from '@angular/core';
import { Result } from '../../../shared/result';
import { firstValueFrom, from, lastValueFrom, mergeMap, Observable, tap, toArray } from 'rxjs';
import { HttpEventType } from '@angular/common/http';
import { apiErrorMessage, toApiError } from '../../../shared/api-error';
import { calcualteSha256 } from '../../../shared/util/sha256';
import { FileEntry } from '../../../data-access/entries/entry-models';
import { UploadApi } from '../../../data-access/uploads/upload-api';
import { TransferFailure, TransferOperation, UploadTransfer } from './transfer-models';
import {
  FileUploadRequest,
  UploadContentRequest,
  UploadIntentResponse,
} from '../../../data-access/uploads/upload-models';
import { MAX_SINGLE_PART_UPLOAD_SIZE_BYTES } from '../../../data-access/uploads/upload-constraints';

type FailureContext = 'preparing' | 'presigning' | 'uploading' | 'finalizing';

const MAX_CONCURRENT_UPLOADS = 3;

@Injectable({ providedIn: 'root' })
export class TransferStore {
  private readonly uploadApi = inject(UploadApi);
  private readonly _transfers = signal<UploadTransfer[]>([]);
  private readonly _panelOpen = signal(false);

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

  clearFinished(): void {
    this._transfers.update((transfers) =>
      transfers.filter((transfer) => transfer.phase !== 'completed' && transfer.phase !== 'failed'),
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

    try {
      if (file.size > MAX_SINGLE_PART_UPLOAD_SIZE_BYTES) {
        const failure: TransferFailure = {
          status: -1,
          code: 'file_too_large',
          message: 'Datoteka ne može biti veća od 100 MB.',
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

      if (file.size === 0) {
        const failure: TransferFailure = {
          status: -1,
          code: 'empty_file',
          message: 'Nije moguće prenijeti praznu datoteku.',
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

      const sha256 = await calcualteSha256(file);

      failureContext = 'presigning';
      const content: UploadContentRequest = {
        contentType,
        size: file.size,
        sha256,
      };

      const intent = await firstValueFrom(createIntent(content));

      this.patch(transferId, { uploadId: intent.uploadId, phase: 'uploading', progress: 0 });
      failureContext = 'uploading';

      const uploadRequest: FileUploadRequest = {
        file,
        url: intent.uploadUrl,
        headers: {
          'Content-Type': intent.requiredHeaders['Content-Type'],
          'x-amz-checksum-sha256': intent.requiredHeaders['x-amz-checksum-sha256'],
        },
      };

      const uploadStartedAt = performance.now();

      await lastValueFrom(
        this.uploadApi.upload(uploadRequest).pipe(
          tap((event) => {
            if (event.type !== HttpEventType.UploadProgress) return;

            const total = event.total ?? file.size;
            const elapsedSeconds = Math.max((performance.now() - uploadStartedAt) / 1000, 0.001);

            this.patch(transferId, {
              progress: total > 0 ? Math.min(100, Math.round((event.loaded / total) * 100)) : null,
              bytesPerSecond: event.loaded / elapsedSeconds,
            });
          }),
        ),
      );

      failureContext = 'finalizing';
      this.patch(transferId, {
        phase: 'finalizing',
        progress: 100,
        bytesPerSecond: null,
      });

      const completed = await firstValueFrom(this.uploadApi.complete(intent.uploadId));
      this.patch(transferId, { phase: 'completed', bytesPerSecond: null, progress: 100 });
      return { ok: true, value: completed };
    } catch (error) {
      const failure = this.mapFailure(error, failureContext);

      this.patch(transferId, { phase: 'failed', bytesPerSecond: null, error: failure });

      return { ok: false, error: failure };
    }
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

    const message = context === 'uploading' ? fallback : apiErrorMessage(error, fallback);

    return { ...error, message };
  }

  togglePanel(): void {
    this._panelOpen.update((open) => !open);
  }

  closePanel(): void {
    this._panelOpen.set(false);
  }
}
