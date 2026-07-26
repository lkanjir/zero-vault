import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { EntryApi } from '../../../data-access/entries/entry-api';
import { EntryList, FolderEntry } from '../../../data-access/entries/entry-models';
import { finalize, Subscription } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { apiErrorMessage, toApiError } from '../../../shared/api-error';

const DESTINATION_PAGE_SIZE = 50;

@Injectable()
export class MoveStore {
  private readonly entryApi = inject(EntryApi);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _parentId = signal<string | null>(null);
  private readonly _path = signal<EntryList['path']>([]);
  private readonly _folders = signal<readonly FolderEntry[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _nextCursor = signal<string | null>(null);
  private readonly _hasMore = signal(false);
  private readonly _loadingMore = signal(false);
  private readonly _loadMoreError = signal<string | null>(null);

  readonly parentId = this._parentId.asReadonly();
  readonly path = this._path.asReadonly();
  readonly folders = this._folders.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  readonly hasMore = this._hasMore.asReadonly();
  readonly loadingMore = this._loadingMore.asReadonly();
  readonly loadMoreError = this._loadMoreError.asReadonly();

  private requestedParentId: string | null = null;

  private loadSubscription?: Subscription;
  private loadMoreSubscription?: Subscription;

  loadFolder(parentId: string | null): void {
    this.loadSubscription?.unsubscribe();
    this.loadMoreSubscription?.unsubscribe();

    this.requestedParentId = parentId;
    this._loading.set(true);
    this._error.set(null);

    this.resetPagination();

    this.loadSubscription = this.entryApi
      .getEntries({ parentId, cursor: null, limit: DESTINATION_PAGE_SIZE })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this._loading.set(false)),
      )
      .subscribe({
        next: (response) => {
          const folders = response.items.filter(
            (entry): entry is FolderEntry => entry.kind === 'folder',
          );
          const reachedFiles = response.items.some((entry) => entry.kind === 'file');

          this._parentId.set(parentId);
          this._path.set(response.path);
          this._folders.set(folders);
          this._nextCursor.set(response.page.nextCursor);
          this._hasMore.set(response.page.hasMore && !reachedFiles);
        },
        error: (error) => {
          this._error.set(apiErrorMessage(toApiError(error), 'Direktorij se ne može učitati.'));
        },
      });
  }

  loadMore(): void {
    if (
      this._loading() ||
      this._loadingMore() ||
      !this._hasMore() ||
      this.loadMoreError() !== null
    ) {
      return;
    }

    const cursor = this._nextCursor();

    if (cursor === null) {
      return;
    }

    this._loadingMore.set(true);
    this._loadMoreError.set(null);

    this.loadMoreSubscription = this.entryApi
      .getEntries({ parentId: this._parentId(), cursor, limit: DESTINATION_PAGE_SIZE })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this._loadingMore.set(false)),
      )
      .subscribe({
        next: (response) => {
          const folders = response.items.filter(
            (entry): entry is FolderEntry => entry.kind === 'folder',
          );
          const reachedFiles = response.items.some((entry) => entry.kind === 'file');

          this._folders.update((current) => [...current, ...folders]);
          this._nextCursor.set(response.page.nextCursor);
          this._hasMore.set(response.page.hasMore && !reachedFiles);
        },
        error: (error) => {
          this._loadMoreError.set(
            apiErrorMessage(toApiError(error), 'Ostali direktoriji ne mogu se učitati.'),
          );
        },
      });
  }

  retry(): void {
    this.loadFolder(this.requestedParentId);
  }

  retryMore(): void {
    this._loadMoreError.set(null);
    this.loadMore();
  }

  private resetPagination(): void {
    this._nextCursor.set(null);
    this._hasMore.set(false);
    this._loadingMore.set(false);
    this._loadMoreError.set(null);
  }
}
