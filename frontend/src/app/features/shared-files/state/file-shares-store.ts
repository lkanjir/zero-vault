import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { SharingApi } from '../../../data-access/sharing/sharing-api';
import { FileShare } from '../../../data-access/sharing/sharing-models';
import { finalize, Subscription } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { apiErrorMessage, toApiError } from '../../../shared/api-error';

const FILE_SHARE_PAGE_SIZE = 20;

@Injectable()
export class FileSharesStore {
  private readonly sharingApi = inject(SharingApi);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _fileId = signal<string | null>(null);
  private readonly _shares = signal<readonly FileShare[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _nextCursor = signal<string | null>(null);
  private readonly _hasMore = signal(false);
  private readonly _loadingMore = signal(false);
  private readonly _loadingMoreError = signal<string | null>(null);

  readonly fileId = this._fileId.asReadonly();
  readonly shares = this._shares.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly nextCursor = this._nextCursor.asReadonly();
  readonly hasMore = this._hasMore.asReadonly();
  readonly loadingMore = this._loadingMore.asReadonly();
  readonly loadingMoreError = this._loadingMoreError.asReadonly();

  private loadSubscription?: Subscription;
  private loadMoreSubscription?: Subscription;

  load(fileId: string): void {
    this.loadSubscription?.unsubscribe();
    this.loadMoreSubscription?.unsubscribe();

    this._fileId.set(fileId);
    this._shares.set([]);
    this._error.set(null);
    this._nextCursor.set(null);
    this._hasMore.set(false);
    this._loadingMore.set(false);
    this._loadingMoreError.set(null);
    this._loading.set(true);

    this.loadSubscription = this.sharingApi
      .getFileShares(fileId, {
        cursor: null,
        limit: FILE_SHARE_PAGE_SIZE,
      })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this._loading.set(false)),
      )
      .subscribe({
        next: (response) => {
          this._shares.set(response.items);
          this._nextCursor.set(response.page.nextCursor);
          this._hasMore.set(response.page.hasMore);
        },
        error: (error) => {
          this._error.set(
            apiErrorMessage(toApiError(error), 'Dijeljenja datoteke nije moguće učitati'),
          );
        },
      });
  }

  reload(): void {
    const fileId = this._fileId();
    if (fileId !== null) {
      this.load(fileId);
    }
  }

  loadMore(): void {
    if (this._loading() || this._loadingMore() || !this.hasMore()) {
      return;
    }

    const fileId = this._fileId();
    const cursor = this._nextCursor();

    if (fileId === null || cursor === null) {
      return;
    }

    this._loadingMore.set(true);
    this._loadingMoreError.set(null);

    this.loadMoreSubscription = this.sharingApi
      .getFileShares(fileId, {
        cursor,
        limit: FILE_SHARE_PAGE_SIZE,
      })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this._loadingMore.set(false)),
      )
      .subscribe({
        next: (response) => {
          this._shares.update((current) => {
            const existingIds = new Set(current.map((share) => share.shareId));
            const newShares = response.items.filter((share) => {
              if (existingIds.has(share.shareId)) {
                return false;
              }

              existingIds.add(share.shareId);
              return true;
            });

            return [...current, ...newShares];
          });

          this._nextCursor.set(response.page.nextCursor);
          this._hasMore.set(response.page.hasMore);
        },
        error: (error) => {
          this._loadingMoreError.set(
            apiErrorMessage(toApiError(error), 'Nije moguće učitati ostala dijeljenja datoteke'),
          );
        },
      });
  }

  retry(): void {
    this.reload();
  }

  retryLoadMore(): void {
    this.loadMore();
  }

  updateShare(updatedShare: FileShare): void {
    this._shares.update((shares) =>
      shares.map((share) => (share.shareId === updatedShare.shareId ? updatedShare : share)),
    );
  }

  removeShare(shareId: string): void {
    this._shares.update((shares) => shares.filter((share) => share.shareId !== shareId));
  }
}
