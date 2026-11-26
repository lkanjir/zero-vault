import { HttpErrorResponse, HttpEvent, HttpEventType, HttpResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  fromEvent,
  last,
  lastValueFrom,
  map,
  Observable,
  race,
  switchMap,
  take,
  tap,
  throwError,
  timer,
} from 'rxjs';
import { UploadApi } from '../../data-access/uploads/upload-api';
import { MULTIPART_STANDARD_PART_SIZE_BYTES } from '../../data-access/uploads/upload-constraints';
import {
  CompletedUploadPart,
  MultipartUploadIntentResponse,
  PresignedUploadPart,
  SinglePartUploadIntentResponse,
} from '../../data-access/uploads/upload-models';
import { calculateBufferSha256 } from '../../shared/util/sha256';

export type UploadProgressSnapshot = {
  progress: number;
  bytesPerSecond: number | null;
};

export class UploadCancelledError extends Error {
  constructor() {
    super('Upload cancelled');
    this.name = 'UploadCancelledError';
  }
}

export function isUploadCancelledError(error: unknown): boolean {
  return error instanceof UploadCancelledError;
}

const STANDARD_PART_CONCURRENCY = 3;
const LARGE_PART_CONCURRENCY = 2;
const MAX_PART_ATTEMPTS = 4;
const BASE_RETRY_DELAY_MS = 500;

@Injectable({ providedIn: 'root' })
export class UploadExecutor {
  private readonly uploadApi = inject(UploadApi);

  async uploadSinglePart(params: {
    file: File;
    intent: SinglePartUploadIntentResponse;
    signal: AbortSignal;
    onProgress: (snapshot: UploadProgressSnapshot) => void;
  }): Promise<void> {
    const { file, intent, signal, onProgress } = params;
    throwIfAborted(signal);

    const uploadStartedAt = performance.now();

    await abortableLastValueFrom(
      this.uploadApi
        .upload({
          file,
          url: intent.uploadUrl,
          headers: {
            'Content-Type': intent.requiredHeaders['Content-Type'],
            'x-amz-checksum-sha256': intent.requiredHeaders['x-amz-checksum-sha256'],
          },
        })
        .pipe(
          tap((event) => {
            if (event.type !== HttpEventType.UploadProgress) {
              return;
            }

            const total = event.total ?? file.size;
            const elapsedSeconds = Math.max((performance.now() - uploadStartedAt) / 1000, 0.001);

            onProgress({
              progress: total > 0 ? Math.min(100, Math.round((event.loaded / total) * 100)) : 100,
              bytesPerSecond: total > 0 ? event.loaded / elapsedSeconds : null,
            });
          }),
        ),
      signal,
    );
  }

  async uploadMultipart(params: {
    file: File;
    intent: MultipartUploadIntentResponse;
    signal: AbortSignal;
    onProgress: (snapshot: UploadProgressSnapshot) => void;
  }): Promise<CompletedUploadPart[]> {
    const { file, intent, signal, onProgress } = params;
    throwIfAborted(signal);

    const concurrency =
      intent.partSizeBytes <= MULTIPART_STANDARD_PART_SIZE_BYTES
        ? STANDARD_PART_CONCURRENCY
        : LARGE_PART_CONCURRENCY;

    const completedParts: CompletedUploadPart[] = [];
    const inFlightBytes = new Map<number, number>();
    let completedBytes = 0;
    const uploadStartedAt = performance.now();

    const reportProgress = () => {
      let activeBytes = 0;
      for (const loaded of inFlightBytes.values()) {
        activeBytes += loaded;
      }

      const totalUploaded = Math.min(file.size, completedBytes + activeBytes);
      const elapsedSeconds = Math.max((performance.now() - uploadStartedAt) / 1000, 0.001);
      const progress =
        file.size > 0 ? Math.min(100, Math.round((totalUploaded / file.size) * 100)) : 100;

      onProgress({
        progress,
        bytesPerSecond: totalUploaded / elapsedSeconds,
      });
    };

    for (let firstPart = 1; firstPart <= intent.partCount; firstPart += concurrency) {
      throwIfAborted(signal);

      const lastPart = Math.min(intent.partCount, firstPart + concurrency - 1);
      const batchParts: Array<{
        partNumber: number;
        sizeBytes: number;
        buffer: ArrayBuffer;
        sha256: string;
      }> = [];

      for (let partNumber = firstPart; partNumber <= lastPart; partNumber++) {
        throwIfAborted(signal);
        const start = (partNumber - 1) * intent.partSizeBytes;
        const end = Math.min(file.size, start + intent.partSizeBytes);
        const buffer = await file.slice(start, end).arrayBuffer();
        throwIfAborted(signal);
        const sha256 = await calculateBufferSha256(buffer);

        batchParts.push({
          partNumber,
          sizeBytes: end - start,
          buffer,
          sha256,
        });
      }

      const presignedResponse = await abortableLastValueFrom(
        this.uploadApi.presignParts(intent.uploadId, {
          parts: batchParts.map(({ partNumber, sha256 }) => ({ partNumber, sha256 })),
        }),
        signal,
      );
      const presignedByPart = new Map(
        presignedResponse.parts.map((part) => [part.partNumber, part]),
      );

      const batchAbortController = new AbortController();
      const batchSignal = combineSignals(signal, batchAbortController.signal);

      try {
        const batchCompleted = await Promise.all(
          batchParts.map(async (part) => {
            const initialPresigned = presignedByPart.get(part.partNumber);
            if (!initialPresigned) {
              throw new Error(`Missing presigned URL for part ${part.partNumber}`);
            }

            try {
              const etag = await this.uploadPartWithRetry({
                uploadId: intent.uploadId,
                partNumber: part.partNumber,
                sizeBytes: part.sizeBytes,
                buffer: part.buffer,
                sha256: part.sha256,
                initialPresigned,
                signal: batchSignal,
                onPartProgress: (loaded) => {
                  inFlightBytes.set(part.partNumber, Math.min(loaded, part.sizeBytes));
                  reportProgress();
                },
                onPartReset: () => {
                  inFlightBytes.delete(part.partNumber);
                  reportProgress();
                },
              });

              inFlightBytes.delete(part.partNumber);
              completedBytes += part.sizeBytes;
              reportProgress();

              return {
                partNumber: part.partNumber,
                etag,
                sha256: part.sha256,
              };
            } catch (error) {
              batchAbortController.abort();
              throw error;
            }
          }),
        );

        completedParts.push(...batchCompleted);
      } catch (error) {
        if (signal.aborted) {
          throw new UploadCancelledError();
        }
        throw error;
      }
    }

    return completedParts;
  }

  private async uploadPartWithRetry(params: {
    uploadId: string;
    partNumber: number;
    sizeBytes: number;
    buffer: ArrayBuffer;
    sha256: string;
    initialPresigned: PresignedUploadPart;
    signal: AbortSignal;
    onPartProgress: (loadedBytes: number) => void;
    onPartReset: () => void;
  }): Promise<string> {
    let presigned = params.initialPresigned;

    for (let attempt = 1; attempt <= MAX_PART_ATTEMPTS; attempt++) {
      throwIfAborted(params.signal);

      try {
        const finalEvent = await abortableLastValueFrom(
          this.uploadApi
            .uploadPart({
              url: presigned.uploadUrl,
              body: params.buffer,
              headers: {
                'x-amz-checksum-sha256': presigned.requiredHeaders['x-amz-checksum-sha256'],
              },
            })
            .pipe(
              tap((event) => {
                if (event.type === HttpEventType.UploadProgress) {
                  params.onPartProgress(event.loaded);
                }
              }),
            ),
          params.signal,
        );

        return extractPartEtag(finalEvent, params.partNumber);
      } catch (error) {
        params.onPartReset();

        if (isUploadCancelledError(error) || params.signal.aborted) {
          throw new UploadCancelledError();
        }

        if (attempt >= MAX_PART_ATTEMPTS || !isRetryablePartError(error)) {
          throw error;
        }

        await abortableDelay(BASE_RETRY_DELAY_MS * 2 ** (attempt - 1), params.signal);

        if (error instanceof HttpErrorResponse && error.status === 403) {
          const refreshed = await abortableLastValueFrom(
            this.uploadApi.presignParts(params.uploadId, {
              parts: [{ partNumber: params.partNumber, sha256: params.sha256 }],
            }),
            params.signal,
          );
          const refreshedPart = refreshed.parts[0];
          if (!refreshedPart) {
            throw new Error(`Missing refreshed presigned URL for part ${params.partNumber}`);
          }
          presigned = refreshedPart;
        }
      }
    }

    throw new Error(`Exceeded retry attempts for part ${params.partNumber}`);
  }
}

function extractPartEtag(event: HttpEvent<void>, partNumber: number): string {
  if (!(event instanceof HttpResponse)) {
    throw new Error(`Upload response missing for part ${partNumber}`);
  }

  const etag = event.headers.get('ETag')?.trim();
  if (!etag) {
    throw new Error(`Missing ETag header for part ${partNumber}`);
  }

  return etag;
}

function isRetryablePartError(error: unknown): boolean {
  if (!(error instanceof HttpErrorResponse)) {
    return false;
  }

  return (
    error.status === 0 ||
    error.status === 403 ||
    error.status === 408 ||
    error.status === 429 ||
    error.status >= 500
  );
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new UploadCancelledError();
  }
}

function combineSignals(parent: AbortSignal, child: AbortSignal): AbortSignal {
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([parent, child]);
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  if (parent.aborted || child.aborted) {
    controller.abort();
    return controller.signal;
  }
  parent.addEventListener('abort', abort, { once: true });
  child.addEventListener('abort', abort, { once: true });
  return controller.signal;
}

export function abortableLastValueFrom<T>(source$: Observable<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new UploadCancelledError());
  }

  return lastValueFrom(
    race(
      source$.pipe(last()),
      fromEvent(signal, 'abort').pipe(
        take(1),
        switchMap(() => throwError(() => new UploadCancelledError())),
      ),
    ),
  );
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return abortableLastValueFrom(timer(ms).pipe(map(() => undefined)), signal);
}
