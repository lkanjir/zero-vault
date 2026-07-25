import { inject, Injectable, signal } from '@angular/core';
import { finalize, Subscription } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { apiErrorMessage, toApiError } from '../../../shared/api-error';
import { EntryList } from '../../../data-access/entries/entry-models';
import { EntryApi } from '../../../data-access/entries/entry-api';

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
}
