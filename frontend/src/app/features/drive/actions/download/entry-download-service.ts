import { inject, Injectable } from '@angular/core';
import { FileApi } from '../../../../data-access/files/file-api';
import { FolderApi } from '../../../../data-access/folders/folder-api';
import { EntryResponse } from '../../../../data-access/entries/entry-models';
import { ApiError, toApiError } from '../../../../shared/api-error';
import { Result } from '../../../../shared/result';
import { FolderDownloadStatusResponse } from '../../../../data-access/folders/folder-models';
import {
  catchError,
  exhaustMap,
  filter,
  firstValueFrom,
  map,
  of,
  switchMap,
  take,
  timer,
} from 'rxjs';

type TerminalFolderDownloadStatus = Exclude<
  FolderDownloadStatusResponse,
  { status: 'queued' | 'processing' }
>;

const DOWNLOAD_POLL_INTERVAL_MS = 2000;

@Injectable({ providedIn: 'root' })
export class EntryDownloadService {
  private readonly fileApi = inject(FileApi);
  private readonly folderApi = inject(FolderApi);

  async prepareDownload(entry: EntryResponse): Promise<Result<string, ApiError>> {
    switch (entry.kind) {
      case 'file':
        return this.getFileDownloadUrl(entry.id);
      case 'folder':
        return this.getFolderDownloadUrl(entry.id);
    }
  }

  private async getFileDownloadUrl(fileId: string): Promise<Result<string, ApiError>> {
    return firstValueFrom(
      this.fileApi.getDownloadUrl(fileId).pipe(
        map((response): Result<string, ApiError> => ({
          ok: true,
          value: response.downloadUrl,
        })),
        catchError((error) =>
          of<Result<string, ApiError>>({ ok: false, error: toApiError(error) }),
        ),
      ),
    );
  }

  private async getFolderDownloadUrl(folderId: string): Promise<Result<string, ApiError>> {
    return firstValueFrom(
      this.folderApi.createDownload(folderId).pipe(
        switchMap(({ downloadId }) =>
          timer(0, DOWNLOAD_POLL_INTERVAL_MS).pipe(
            exhaustMap(() => this.folderApi.getDownloadStatus(downloadId)),
            filter(
              (status): status is TerminalFolderDownloadStatus =>
                status.status !== 'queued' && status.status !== 'processing',
            ),
            take(1),
            map((status): Result<string, ApiError> => {
              if (status.status === 'ready') {
                return {
                  ok: true,
                  value: status.downloadUrl,
                };
              }

              return {
                ok: false,
                error: {
                  status: -1,
                  code: `folder_download_${status.status}`,
                },
              };
            }),
          ),
        ),
        catchError((error) =>
          of<Result<string, ApiError>>({ ok: false, error: toApiError(error) }),
        ),
      ),
    );
  }
}
