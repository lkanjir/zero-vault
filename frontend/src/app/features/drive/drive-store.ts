import { inject, Injectable, signal } from '@angular/core';
import { catchError, finalize, firstValueFrom, map, of, Subscription } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiError, apiErrorMessage, toApiError } from '../../shared/api-error';
import { Result } from '../../shared/result';
import { EntryList, EntryResponse, FolderEntry } from '../../data-access/entries/entry-models';
import { EntryApi } from '../../data-access/entries/entry-api';
import { FolderApi } from '../../data-access/folders/folder-api';

@Injectable({ providedIn: 'root' })
export class DriveStore {
  private readonly entryApi = inject(EntryApi);
  private readonly folderApi = inject(FolderApi);

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

    this.loadSubscription = this.entryApi
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
      this.folderApi.createFolder({ name: name, parentId: targetParentId }).pipe(
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

  async renameEntry(entryId: string, name: string): Promise<Result<EntryResponse, ApiError>> {
    const result = await firstValueFrom(
      this.entryApi.updateEntry(entryId, { name }).pipe(
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
      this.entryApi.updateEntry(entryId, { parentId: targetParentId }).pipe(
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
