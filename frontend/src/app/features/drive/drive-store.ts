import { inject, Injectable, signal } from '@angular/core';
import { FolderService } from './folder-service';
import { EntryList, EntryResponse } from './dto/entry';
import {
  catchError,
  exhaustMap,
  filter,
  finalize,
  firstValueFrom,
  map,
  of,
  Subscription,
  switchMap,
  take,
  timer,
} from 'rxjs';
import { EntryService } from './entry-service';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiError, apiErrorMessage, toApiError } from '../../shared/api-error';
import { Result } from '../../shared/result';
import { FolderEntry } from './dto/folder';
import { FileService } from './file-service';
import { FolderDownloadStatusResponse } from './dto/folder-download';

const DOWNLOAD_POLL_INTERVAL_MS = 2000;

type TerminalFolderDownloadStatus = Exclude<
  FolderDownloadStatusResponse,
  { status: 'queued' | 'processing' }
>;

@Injectable({ providedIn: 'root' })
export class DriveStore {
  private readonly entryService = inject(EntryService);
  private readonly folderService = inject(FolderService);
  private readonly fileService = inject(FileService);

  private readonly _path = signal<EntryList['path']>([]);
  private readonly _parentId = signal<string | null>(null);
  private readonly _entries = signal<EntryList['items']>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _nextCursor = signal<string | null>(null);
  private readonly _hasMore = signal(false);

  readonly path = this._path.asReadonly();
  readonly parentId = this._parentId.asReadonly();
  readonly entries = this._entries.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly nextCursor = this._nextCursor.asReadonly();
  readonly hasMore = this._hasMore.asReadonly();

  private loadSubscription?: Subscription;
  loadFolder(parentId: string | null): void {
    this.loadSubscription?.unsubscribe();

    const folderChanged = this._parentId() !== parentId;

    if (folderChanged) {
      this._path.set([]);
      this._entries.set([]);
      this._nextCursor.set(null);
      this._hasMore.set(false);
    }

    this._loading.set(true);
    this._parentId.set(parentId);
    this._error.set(null);

    this.loadSubscription = this.entryService
      .getEntries({ parentId: parentId, cursor: null, limit: 50 })
      .pipe(finalize(() => this._loading.set(false)))
      .subscribe({
        next: (response) => {
          this._path.set(response.path);
          this._entries.set(response.items);
          this._nextCursor.set(response.page.nextCursor);
          this._hasMore.set(response.page.hasMore);
        },
        error: (error: HttpErrorResponse) => {
          this._error.set(
            apiErrorMessage(toApiError(error), 'Datoteke se trenutno ne mogu učitati'),
          );
        },
      });
  }

  reload(): void {
    this.loadFolder(this._parentId());
  }

  reloadIfCurrent(parentId: string | null): void {
    if (this._parentId() === parentId) {
      this.reload();
    }
  }

  async createFolder(name: string): Promise<Result<FolderEntry, ApiError>> {
    const targetParentId = this._parentId();

    const result = await firstValueFrom(
      this.folderService.createFolder({ name: name, parentId: targetParentId }).pipe(
        map((folder): Result<FolderEntry, ApiError> => ({ ok: true, value: folder })),
        catchError((error) =>
          of<Result<FolderEntry, ApiError>>({ ok: false, error: toApiError(error) }),
        ),
      ),
    );

    if (result.ok && this._parentId() === targetParentId) {
      this._entries.update((current) => [result.value, ...current]);
    }

    return result;
  }

  async getFileDownloadUrl(fileId: string): Promise<Result<string, ApiError>> {
    return firstValueFrom(
      this.fileService.getDownloadUrl(fileId).pipe(
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

  async getFolderDownloadUrl(folderId: string): Promise<Result<string, ApiError>> {
    return firstValueFrom(
      this.folderService.createDownload(folderId).pipe(
        switchMap(({ downloadId }) =>
          timer(0, DOWNLOAD_POLL_INTERVAL_MS).pipe(
            exhaustMap(() => this.folderService.getDownloadStatus(downloadId)),
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

  async renameEntry(entryId: string, name: string): Promise<Result<EntryResponse, ApiError>> {
    const result = await firstValueFrom(
      this.entryService.updateEntry(entryId, { name }).pipe(
        map((updatedEntry): Result<EntryResponse, ApiError> => ({
          ok: true,
          value: updatedEntry,
        })),
        catchError((error) =>
          of<Result<EntryResponse, ApiError>>({ ok: false, error: toApiError(error) }),
        ),
      ),
    );

    if (result.ok) {
      this._entries.update((current) =>
        current.map((entry) => (entry.id === result.value.id ? result.value : entry)),
      );
    }

    return result;
  }

  async moveEntry(
    entryId: string,
    targetParentId: string | null,
  ): Promise<Result<EntryResponse, ApiError>> {
    const sourceParentId = this._parentId();

    const result = await firstValueFrom(
      this.entryService.updateEntry(entryId, { parentId: targetParentId }).pipe(
        map((updatedEntry): Result<EntryResponse, ApiError> => ({
          ok: true,
          value: updatedEntry,
        })),
        catchError((error) =>
          of<Result<EntryResponse, ApiError>>({ ok: false, error: toApiError(error) }),
        ),
      ),
    );

    if (result.ok && this._parentId() === sourceParentId) {
      if (targetParentId === sourceParentId) {
        this._entries.update((current) =>
          current.map((entry) => (entry.id === result.value.id ? result.value : entry)),
        );
      } else {
        this._entries.update((current) => current.filter((entry) => entry.id !== result.value.id));
      }
    }

    return result;
  }
}
