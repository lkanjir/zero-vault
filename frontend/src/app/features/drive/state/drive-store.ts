import { inject, Injectable, signal } from '@angular/core';
import { finalize, Subscription } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { apiErrorMessage, toApiError } from '../../../shared/api-error';
import { EntryList } from '../../../data-access/entries/entry-models';
import { EntryApi } from '../../../data-access/entries/entry-api';

const ENTRY_PAGE_SIZE = 50;

@Injectable({ providedIn: 'root' })
export class DriveStore {
  private readonly entryApi = inject(EntryApi);

  private readonly _path = signal<EntryList['path']>([]);
  private readonly _parentId = signal<string | null>(null);
  private readonly _entries = signal<EntryList['items']>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _nextCursor = signal<string | null>(null);
  private readonly _hasMore = signal(false);
  private readonly _loadingMore = signal(false);
  private readonly _loadMoreError = signal<string | null>(null);

  readonly path = this._path.asReadonly();
  readonly parentId = this._parentId.asReadonly();
  readonly entries = this._entries.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly nextCursor = this._nextCursor.asReadonly();
  readonly hasMore = this._hasMore.asReadonly();
  readonly loadingMore = this._loadingMore.asReadonly();
  readonly loadMoreError = this._loadMoreError.asReadonly();

  private loadSubscription?: Subscription;
  private loadMoreSubscription?: Subscription;

  loadFolder(parentId: string | null): void {
    this.loadSubscription?.unsubscribe();
    this.loadMoreSubscription?.unsubscribe();

    const folderChanged = this._parentId() !== parentId;

    if (folderChanged) {
      this._path.set([]);
      this._entries.set([]);
    }

    this.resetPagination();
    this._loading.set(true);
    this._parentId.set(parentId);
    this._error.set(null);

    this.loadSubscription = this.entryApi
      .getEntries({ parentId: parentId, cursor: null, limit: ENTRY_PAGE_SIZE })
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

  loadMore(): void {
    if (this._loading() || this._loadingMore() || !this._hasMore()) {
      return;
    }

    const parentId = this._parentId();
    const cursor = this._nextCursor();

    if (cursor === null) {
      return;
    }

    this._loadingMore.set(true);
    this._loadMoreError.set(null);

    this.loadMoreSubscription = this.entryApi
      .getEntries({
        parentId,
        cursor,
        limit: ENTRY_PAGE_SIZE,
      })
      .pipe(finalize(() => this._loadingMore.set(false)))
      .subscribe({
        next: (response) => {
          if (this._parentId() !== parentId || this._nextCursor() !== cursor) {
            return;
          }

          this._entries.update((current) => {
            const existingIds = new Set(current.map((entry) => entry.id));

            const newEntries = response.items.filter((entry) => {
              if (existingIds.has(entry.id)) {
                return false;
              }

              existingIds.add(entry.id);
              return true;
            });

            return [...current, ...newEntries];
          });

          this._nextCursor.set(response.page.nextCursor);
          this._hasMore.set(response.page.hasMore);
        },
        error: (error: HttpErrorResponse) => {
          if (this._parentId() !== parentId || this._nextCursor() !== cursor) {
            return;
          }

          this._loadMoreError.set(
            apiErrorMessage(toApiError(error), 'Ostale datoteke ne mogu se učitati'),
          );
        },
      });
  }

  removeIfCurrent(parentId: string | null, entryId: string): void {
    if (this._parentId() !== parentId) {
      return;
    }

    this._entries.update((entries) => entries.filter((entry) => entry.id !== entryId));
  }

  private resetPagination(): void {
    this._nextCursor.set(null);
    this._hasMore.set(false);
    this._loadingMore.set(false);
    this._loadMoreError.set(null);
  }
}
