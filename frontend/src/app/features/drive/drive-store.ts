import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { FolderService } from './folder-service';
import { EntryList } from './dto/entry';
import { finalize, firstValueFrom, Subscription } from 'rxjs';
import { EntryService } from './entry-service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';

@Injectable({ providedIn: 'root' })
export class DriveStore {
  private readonly entryService = inject(EntryService);
  private readonly folderService = inject(FolderService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _parentId = signal<string | null>(null);
  private readonly _entries = signal<EntryList['items']>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _nextCursor = signal<string | null>(null);
  private readonly _hasMore = signal(false);

  readonly parentId = this._parentId.asReadonly();
  readonly entries = this._entries.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly nextCursor = this._nextCursor.asReadonly();
  readonly hasMore = this._hasMore.asReadonly();

  private loadSubscription?: Subscription;
  loadFolder(parentId: string | null): void {
    this.loadSubscription?.unsubscribe();

    this._loading.set(true);
    this._parentId.set(parentId);
    this._error.set(null);

    this.loadSubscription = this.entryService
      .getEntries({ parentId: parentId, cursor: null, limit: 50 })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this._loading.set(false)),
      )
      .subscribe({
        next: (response) => {
          this._entries.set(response.items);
          this._nextCursor.set(response.page.nextCursor);
          this._hasMore.set(response.page.hasMore);
        },
        error: (error: HttpErrorResponse) => {
          this._error.set(this.getErrorMessage(error));
        },
      });
  }

  reload(): void {
    this.loadFolder(this._parentId());
  }

  async createFolder(name: string): Promise<void> {
    const folder = await firstValueFrom(
      this.folderService.createFolder({ name: name, parentKey: this._parentId() }),
    );

    this._entries.update((entries) => [folder, ...entries]);
  }

  private getErrorMessage(error: HttpErrorResponse): string {
    switch (error.status) {
      case 0:
        return 'Backend nije dostupan.';
      case 400:
        return 'Zahtjev nije ispravan.';
      case 403:
        return 'Nemaš dopuštenje za ovaj sadržaj.';
      case 404:
        return 'Mapa ne postoji.';
      default:
        return 'Datoteke se trenutno ne mogu učitati.';
    }
  }
}
