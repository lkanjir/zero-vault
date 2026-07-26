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

  readonly parentId = this._parentId.asReadonly();
  readonly path = this._path.asReadonly();
  readonly folders = this._folders.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  private loadSubscription?: Subscription;

  loadFolder(parentId: string | null): void {
    this.loadSubscription?.unsubscribe();

    this._parentId.set(parentId);
    this._path.set([]);
    this._folders.set([]);
    this._loading.set(true);
    this._error.set(null);

    this.loadSubscription = this.entryApi
      .getEntries({ parentId, cursor: null, limit: DESTINATION_PAGE_SIZE })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this._loading.set(false)),
      )
      .subscribe({
        next: (response) => {
          this._path.set(response.path);
          this._folders.set(
            response.items.filter((entry): entry is FolderEntry => entry.kind === 'folder'),
          );
        },
        error: (error) => {
          this._error.set(apiErrorMessage(toApiError(error), 'Direktorij se ne može učitati.'));
        },
      });
  }

  retry(): void {
    this.loadFolder(this._parentId());
  }
}
