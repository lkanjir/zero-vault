import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { SharingApi } from '../../../data-access/sharing/sharing-api';
import { SharedWithMeFile } from '../../../data-access/sharing/sharing-models';
import { finalize } from 'rxjs';
import { apiErrorMessage, toApiError } from '../../../shared/api-error';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FileEntry } from '../../../data-access/entries/entry-models';

const SHARED_FILE_PAGE_SIZE = 50;

@Injectable()
export class SharedWithMeStore {
  private readonly sharingApi = inject(SharingApi);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _files = signal<readonly SharedWithMeFile[]>([]);
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
      .getSharedWithMeFiles({ cursor: null, limit: SHARED_FILE_PAGE_SIZE })
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
            apiErrorMessage(toApiError(error), 'Greška kod učitavanja dijeljenih datoteka'),
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
      .getSharedWithMeFiles({ cursor, limit: SHARED_FILE_PAGE_SIZE })
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
            apiErrorMessage(toApiError(error), 'Greška kod učitavanja datoteka'),
          );
        },
      });
  }

  retryLoadMore(): void {
    this.loadMore();
  }

  fileUpdated(entry: FileEntry): void {
    this._files.update((files) => {
      const index = files.findIndex((file) => file.id === entry.id);

      if (index === -1) {
        return files;
      }

      const updatedFiles = [...files];
      updatedFiles[index] = {
        ...files[index],
        ...entry,
      };

      return updatedFiles;
    });
  }
}
