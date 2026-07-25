import { computed, inject, Injectable, signal } from '@angular/core';
import { Result } from '../../../shared/result';
import { firstValueFrom, from, lastValueFrom, mergeMap, tap, toArray } from 'rxjs';
import { HttpEventType } from '@angular/common/http';
import { apiErrorMessage, toApiError } from '../../../shared/api-error';
import { calcualteSha256 } from '../../../shared/util/sha256';
import { FileEntry } from '../../../data-access/entries/entry-models';
import { UploadApi } from '../data-access/upload-api';
import { TransferFailure, UploadTransfer } from './transfer-models';
import { FileUploadRequest, UploadIntentRequest } from '../data-access/upload-models';

type FailureContext = 'preparing' | 'presigning' | 'uploading' | 'finalizing';

const MAX_CONCURRENT_UPLOADS = 3;

@Injectable({ providedIn: 'root' })
export class TransferStore {
  private readonly uploadApi = inject(UploadApi);

  private readonly _transfers = signal<UploadTransfer[]>([]);

  readonly transfers = this._transfers.asReadonly();
  readonly failedCount = computed(
    () => this._transfers().filter((transfer) => transfer.phase === 'failed').length,
  );

  async startUpload(
    file: File,
    targetParentId: string | null,
  ): Promise<Result<FileEntry, TransferFailure>> {
    const transferId = crypto.randomUUID();
    const contentType = file.type.trim() || 'application/octet-stream';

    this._transfers.update((transfers) => [
      {
        id: transferId,
        uploadId: null,
        targetParentId,
        fileName: file.name,
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
      const sha256 = await calcualteSha256(file);

      failureContext = 'presigning';
      const intentRequest: UploadIntentRequest = {
        fileName: file.name,
        contentType,
        size: file.size,
        sha256,
        parentFolderId: targetParentId,
      };

      const intent = await firstValueFrom(this.uploadApi.createIntent(intentRequest));

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

  remove(transferId: string): void {
    this._transfers.update((transfers) =>
      transfers.filter((transfer) => {
        if (transfer.id !== transferId) return true;

        return transfer.phase !== 'failed' && transfer.phase !== 'completed';
      }),
    );
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
}
