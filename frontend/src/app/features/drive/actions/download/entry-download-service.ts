import { inject, Injectable } from '@angular/core';
import { Observable, take } from 'rxjs';
import { FileApi } from '../../../../data-access/files/file-api';
import { FolderApi } from '../../../../data-access/folders/folder-api';
import { EntryResponse } from '../../../../data-access/entries/entry-models';
import { ApiError, toApiError } from '../../../../shared/api-error';
import { Result } from '../../../../shared/result';

export const DEFAULT_DOWNLOAD_POLL_INTERVAL_MS = 2_000;
export const MIN_DOWNLOAD_POLL_INTERVAL_MS = 1_000;
export const MAX_DOWNLOAD_POLL_INTERVAL_MS = 30_000;
export const DOWNLOAD_POLL_TIMEOUT_MS = 10 * 60 * 1_000;

export type PrepareDownloadOptions = {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
};

class DownloadCancelledError extends Error {
  constructor() {
    super('Preuzimanje je otkazano.');
    this.name = 'DownloadCancelledError';
  }
}

export function parseRetryAfterMs(
  headerValue: string | null,
  nowMs: number = Date.now(),
): number | null {
  if (headerValue === null) {
    return null;
  }

  const trimmed = headerValue.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return clampPollInterval(seconds * 1_000);
  }

  const targetMs = Date.parse(trimmed);
  if (Number.isNaN(targetMs)) {
    return null;
  }

  return clampPollInterval(Math.max(0, targetMs - nowMs));
}

function clampPollInterval(ms: number): number {
  return Math.min(Math.max(ms, MIN_DOWNLOAD_POLL_INTERVAL_MS), MAX_DOWNLOAD_POLL_INTERVAL_MS);
}

@Injectable({ providedIn: 'root' })
export class EntryDownloadService {
  private readonly fileApi = inject(FileApi);
  private readonly folderApi = inject(FolderApi);

  async prepareDownload(
    entry: EntryResponse,
    options: PrepareDownloadOptions = {},
  ): Promise<Result<string, ApiError>> {
    if (options.signal?.aborted) {
      return this.cancelledResult();
    }

    switch (entry.kind) {
      case 'file':
        return this.getFileDownloadUrl(entry.id, options.signal);
      case 'folder':
        return this.getFolderDownloadUrl(
          entry.id,
          options.signal,
          options.timeoutMs ?? DOWNLOAD_POLL_TIMEOUT_MS,
        );
    }
  }

  private async getFileDownloadUrl(
    fileId: string,
    signal?: AbortSignal,
  ): Promise<Result<string, ApiError>> {
    try {
      const response = await this.firstValueWithSignal(this.fileApi.getDownloadUrl(fileId), signal);
      return { ok: true, value: response.downloadUrl };
    } catch (error) {
      if (error instanceof DownloadCancelledError) {
        return this.cancelledResult();
      }

      return { ok: false, error: toApiError(error) };
    }
  }

  private async getFolderDownloadUrl(
    folderId: string,
    signal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<Result<string, ApiError>> {
    const deadlineMs = Date.now() + timeoutMs;

    try {
      const createResponse = await this.firstValueWithSignal(
        this.folderApi.createDownload(folderId),
        signal,
      );
      const downloadId = createResponse.body?.downloadId;

      if (!downloadId) {
        return {
          ok: false,
          error: { status: -1, code: 'unexpected_error' },
        };
      }

      let nextDelayMs = parseRetryAfterMs(createResponse.headers.get('Retry-After')) ?? 0;

      while (true) {
        if (nextDelayMs > 0) {
          const remainingMs = deadlineMs - Date.now();
          if (remainingMs <= 0) {
            return this.timeoutResult();
          }

          await this.sleepWithSignal(Math.min(nextDelayMs, remainingMs), signal);
        }

        if (Date.now() >= deadlineMs) {
          return this.timeoutResult();
        }

        const statusResponse = await this.firstValueWithSignal(
          this.folderApi.getDownloadStatus(downloadId),
          signal,
        );
        const status = statusResponse.body;

        if (!status) {
          return {
            ok: false,
            error: { status: -1, code: 'unexpected_error' },
          };
        }

        if (status.status === 'ready') {
          return { ok: true, value: status.downloadUrl };
        }

        if (status.status === 'failed' || status.status === 'expired') {
          return {
            ok: false,
            error: {
              status: -1,
              code: `folder_download_${status.status}`,
            },
          };
        }

        nextDelayMs =
          parseRetryAfterMs(statusResponse.headers.get('Retry-After')) ??
          DEFAULT_DOWNLOAD_POLL_INTERVAL_MS;
      }
    } catch (error) {
      if (error instanceof DownloadCancelledError) {
        return this.cancelledResult();
      }

      return { ok: false, error: toApiError(error) };
    }
  }

  private firstValueWithSignal<T>(source$: Observable<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) {
      return Promise.reject(new DownloadCancelledError());
    }

    return new Promise<T>((resolve, reject) => {
      let settled = false;

      const onAbort = () => {
        if (settled) {
          return;
        }
        settled = true;
        subscription.unsubscribe();
        reject(new DownloadCancelledError());
      };

      signal?.addEventListener('abort', onAbort, { once: true });

      const subscription = source$.pipe(take(1)).subscribe({
        next: (value) => {
          if (settled) {
            return;
          }
          settled = true;
          signal?.removeEventListener('abort', onAbort);
          resolve(value);
        },
        error: (error: unknown) => {
          if (settled) {
            return;
          }
          settled = true;
          signal?.removeEventListener('abort', onAbort);
          reject(error);
        },
        complete: () => {
          if (settled) {
            return;
          }
          settled = true;
          signal?.removeEventListener('abort', onAbort);
          reject(new Error('Zahtjev preuzimanja završen je bez odgovora.'));
        },
      });
    });
  }

  private sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return Promise.reject(new DownloadCancelledError());
    }

    return new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new DownloadCancelledError());
      };

      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);

      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  private cancelledResult(): Result<string, ApiError> {
    return {
      ok: false,
      error: {
        status: -1,
        code: 'download_cancelled',
      },
    };
  }

  private timeoutResult(): Result<string, ApiError> {
    return {
      ok: false,
      error: {
        status: -1,
        code: 'folder_download_timeout',
        message: 'Priprema arhive je predugo trajala. Pokušaj ponovno.',
      },
    };
  }
}
