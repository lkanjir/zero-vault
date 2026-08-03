import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { SharingApi } from '../../../data-access/sharing/sharing-api';
import { SharedFile } from '../../../data-access/sharing/sharing-models';
import { finalize } from 'rxjs';
import { apiErrorMessage, toApiError } from '../../../shared/api-error';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

const SHARED_FILE_PAGE_SIZE = 50;

@Injectable()
export class SharedFileStore {
  private readonly sharingApi = inject(SharingApi);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _files = signal<readonly SharedFile[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _nextCursor = signal<string | null>(null);
  private readonly _hasMore = signal(false);

  readonly files = this._files.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly nextCursor = this._nextCursor.asReadonly();
  readonly hasMore = this._hasMore.asReadonly();

  load(): void {
    if (this._loading()) {
      return;
    }

    this._files.set([]);
    this._error.set(null);
    this._nextCursor.set(null);
    this._hasMore.set(false);
    this._loading.set(true);

    this.sharingApi
      .getSharedFiles({ cursor: null, limit: SHARED_FILE_PAGE_SIZE })
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
}
