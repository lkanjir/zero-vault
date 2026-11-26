import { inject, Injectable } from '@angular/core';
import {
  catchError,
  EMPTY,
  expand,
  filter,
  firstValueFrom,
  fromEvent,
  map,
  Observable,
  of,
  race,
  switchMap,
  take,
  timer,
} from 'rxjs';
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

type PollStep =
  | { readonly done: true; readonly result: Result<string, ApiError> }
  | { readonly done: false; readonly delayMs: number };

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

function cancelledResult(): Result<string, ApiError> {
  return {
    ok: false,
    error: {
      status: -1,
      code: 'download_cancelled',
    },
  };
}

function timeoutResult(): Result<string, ApiError> {
  return {
    ok: false,
    error: {
      status: -1,
      code: 'folder_download_timeout',
      message: 'Priprema arhive je predugo trajala. Pokušaj ponovno.',
    },
  };
}

function withAbortSignal(
  source$: Observable<Result<string, ApiError>>,
  signal?: AbortSignal,
): Observable<Result<string, ApiError>> {
  if (!signal) {
    return source$;
  }

  if (signal.aborted) {
    return of(cancelledResult());
  }

  return race(
    source$,
    fromEvent(signal, 'abort').pipe(
      take(1),
      map(() => cancelledResult()),
    ),
  );
}

@Injectable({ providedIn: 'root' })
export class EntryDownloadService {
  private readonly fileApi = inject(FileApi);
  private readonly folderApi = inject(FolderApi);

  prepareDownload(
    entry: EntryResponse,
    options: PrepareDownloadOptions = {},
  ): Promise<Result<string, ApiError>> {
    const source$ =
      entry.kind === 'file'
        ? this.getFileDownloadUrl$(entry.id)
        : this.getFolderDownloadUrl$(entry.id, options.timeoutMs ?? DOWNLOAD_POLL_TIMEOUT_MS);

    return firstValueFrom(withAbortSignal(source$, options.signal));
  }

  private getFileDownloadUrl$(fileId: string): Observable<Result<string, ApiError>> {
    return this.fileApi.getDownloadUrl(fileId).pipe(
      map((response): Result<string, ApiError> => ({
        ok: true,
        value: response.downloadUrl,
      })),
      catchError((error) => of<Result<string, ApiError>>({ ok: false, error: toApiError(error) })),
    );
  }

  private getFolderDownloadUrl$(
    folderId: string,
    timeoutMs: number,
  ): Observable<Result<string, ApiError>> {
    const deadlineMs = Date.now() + timeoutMs;

    return this.folderApi.createDownload(folderId).pipe(
      switchMap((createResponse) => {
        const downloadId = createResponse.body?.downloadId;
        if (!downloadId) {
          return of<Result<string, ApiError>>({
            ok: false,
            error: { status: -1, code: 'unexpected_error' },
          });
        }

        const initialDelayMs = parseRetryAfterMs(createResponse.headers.get('Retry-After')) ?? 0;
        return this.pollFolderDownload$(downloadId, initialDelayMs, deadlineMs);
      }),
      catchError((error) => of<Result<string, ApiError>>({ ok: false, error: toApiError(error) })),
    );
  }

  private pollFolderDownload$(
    downloadId: string,
    initialDelayMs: number,
    deadlineMs: number,
  ): Observable<Result<string, ApiError>> {
    const pollOnce = (delayMs: number): Observable<PollStep> => {
      const remainingMs = deadlineMs - Date.now();
      if (remainingMs <= 0) {
        return of({ done: true, result: timeoutResult() });
      }

      const wait$ = delayMs > 0 ? timer(Math.min(delayMs, remainingMs)) : of(0);

      return wait$.pipe(
        switchMap(() => {
          if (Date.now() >= deadlineMs) {
            return of<PollStep>({ done: true, result: timeoutResult() });
          }

          return this.folderApi.getDownloadStatus(downloadId).pipe(
            map((response): PollStep => {
              const status = response.body;
              if (!status) {
                return {
                  done: true,
                  result: { ok: false, error: { status: -1, code: 'unexpected_error' } },
                };
              }

              if (status.status === 'ready') {
                return { done: true, result: { ok: true, value: status.downloadUrl } };
              }

              if (status.status === 'failed' || status.status === 'expired') {
                return {
                  done: true,
                  result: {
                    ok: false,
                    error: { status: -1, code: `folder_download_${status.status}` },
                  },
                };
              }

              return {
                done: false,
                delayMs:
                  parseRetryAfterMs(response.headers.get('Retry-After')) ??
                  DEFAULT_DOWNLOAD_POLL_INTERVAL_MS,
              };
            }),
          );
        }),
      );
    };

    return pollOnce(initialDelayMs).pipe(
      expand((step) => (step.done ? EMPTY : pollOnce(step.delayMs))),
      filter((step): step is Extract<PollStep, { done: true }> => step.done),
      take(1),
      map((step) => step.result),
    );
  }
}
