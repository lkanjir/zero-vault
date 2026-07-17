import { computed, inject, Injectable, signal } from '@angular/core';
import { FileService } from '../file-service';
import { TransferFailure, UploadTransfer } from './transfer';
import { FileUploadRequest, UploadCompleteResponse, UploadIntentRequest } from '../dto/upload';
import { Result } from '../../../shared/result';
import { firstValueFrom, lastValueFrom, tap } from 'rxjs';
import { HttpEventType } from '@angular/common/http';
import { apiErrorMessage, toApiError } from '../../../shared/api-error';
import { calcualteSha256 } from '../../../shared/util/sha256';

type FailureContext = 'preparing' | 'presigning' | 'uploading' | 'finalizing';

@Injectable({ providedIn: 'root' })
export class TransferStore {
  private readonly fileService = inject(FileService);

  private readonly _transfers = signal<UploadTransfer[]>([]);

  readonly transfers = this._transfers.asReadonly();
  readonly failedCount = computed(
    () => this._transfers().filter((transfer) => transfer.phase === 'failed').length,
  );

  async startUplaod(
    file: File,
    targetParentId: string | null,
  ): Promise<Result<UploadCompleteResponse, TransferFailure>> {
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

      const intent = await firstValueFrom(this.fileService.getPresignedUrl(intentRequest));

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
        this.fileService.uploadFile(uploadRequest).pipe(
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

      const completed = await firstValueFrom(this.fileService.completeRequest(intent.uploadId));
      this.patch(transferId, { phase: 'finalizing', bytesPerSecond: null, progress: 100 });
      return { ok: true, value: completed };
    } catch (error) {
      const failure = this.mapFailure(error, failureContext);

      this.patch(transferId, { phase: 'failed', bytesPerSecond: null, error: failure });

      return { ok: false, error: failure };
    }
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
      preparing: 'Datoteka se nije mogla pripremiti.',
      presigning: 'Prijenos datoteke nije moguće započeti.',
      uploading: 'Prijenos datoteke u pohranu nije uspio.',
      finalizing: 'Datoteka je prenesena, ali dovršavanje nije uspjelo.',
    }[context];

    const message = context === 'uploading' ? fallback : apiErrorMessage(error, fallback);

    return { ...error, message };
  }
}
