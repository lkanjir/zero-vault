import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { SharingApi } from '../../../data-access/sharing/sharing-api';
import { SharedByMeFile } from '../../../data-access/sharing/sharing-models';
import { finalize } from 'rxjs';
import { apiErrorMessage, toApiError } from '../../../shared/api-error';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

const SHARED_FILE_PAGE_SIZE = 50;

@Injectable()
export class SharedByMeStore {
  private readonly sharingApi = inject(SharingApi);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _files = signal<readonly SharedByMeFile[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _nextCursor = signal<string | null>(null);
  private readonly _hasMore = signal(false);
  private readonly _loadingMore = signal(false);
  private readonly _loadingMoreError = signal<string | null>(null);

  readonly files = this._files.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly nextCursor = this._nextCursor.asReadonly();
  readonly hasMore = this._hasMore.asReadonly();
  readonly loadingMore = this._loadingMore.asReadonly();
  readonly loadingMoreError = this._loadingMoreError.asReadonly();

  load(): void {
    if (this._loading()) {
      return;
    }

    this._files.set([]);
    this._error.set(null);
    this._nextCursor.set(null);
    this._hasMore.set(false);
    this._loading.set(true);
    this._loadingMore.set(false);
    this._loadingMoreError.set(null);

    this.sharingApi
      .getSharedByMeFiles({ cursor: null, limit: SHARED_FILE_PAGE_SIZE })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this._loading.set(false)),
      )
      .subscribe({
        next: (response) => {
          this._files.set(response.items);
          this._nextCursor.set(response.page.nextCursor);
          this._hasMore.set(response.page.hasMore);
        },
        error: (error) => {
          this._error.set(
            apiErrorMessage(toApiError(error), 'Datoteke koje dijelite nije moguće učitati'),
          );
        },
      });
  }

  retry(): void {
    this.load();
  }

  loadMore(): void {
    if (this._loading() || this._loadingMore() || !this._hasMore()) {
      return;
    }

    const cursor = this._nextCursor();

    if (cursor === null) {
      return;
    }

    this._loadingMore.set(true);
    this._loadingMoreError.set(null);

    this.sharingApi
      .getSharedByMeFiles({ cursor, limit: SHARED_FILE_PAGE_SIZE })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this._loadingMore.set(false)),
      )
      .subscribe({
        next: (response) => {
          this._files.update((current) => {
            const existingIds = new Set(current.map((file) => file.id));
            const newFiles = response.items.filter((file) => {
              if (existingIds.has(file.id)) {
                return false;
              }

              existingIds.add(file.id);
              return true;
            });

            return [...current, ...newFiles];
          });

          this._nextCursor.set(response.page.nextCursor);
          this._hasMore.set(response.page.hasMore);
        },
        error: (error) => {
          this._loadingMoreError.set(
            apiErrorMessage(toApiError(error), 'Dodatne datoteke nije moguće učitati'),
          );
        },
      });
  }

  retryLoadMore(): void {
    this.loadMore();
  }

  shareRevoked(fileId: string): void {
    this._files.update((files) => {
      const index = files.findIndex((file) => file.id === fileId);

      if (index === -1) {
        return files;
      }

      const file = files[index];
      const updatedFiles = [...files];

      if (file.shareCount <= 1) {
        updatedFiles.splice(index, 1);
      } else {
        updatedFiles[index] = {
          ...file,
          shareCount: file.shareCount - 1,
        };
      }

      return updatedFiles;
    });
  }
}
