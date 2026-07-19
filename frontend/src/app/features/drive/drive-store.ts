import { inject, Injectable, signal } from '@angular/core';
import { FolderService } from './folder-service';
import { EntryList } from './dto/entry';
import { catchError, finalize, firstValueFrom, map, of, Subscription } from 'rxjs';
import { EntryService } from './entry-service';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiError, apiErrorMessage, toApiError } from '../../shared/api-error';
import { Result } from '../../shared/result';
import { Folder } from './dto/folder';
import { FileService } from './file-service';
import { FileEntry } from './dto/file';

@Injectable({ providedIn: 'root' })
export class DriveStore {
  private readonly entryService = inject(EntryService);
  private readonly folderService = inject(FolderService);
  private readonly fileService = inject(FileService);

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
      .pipe(finalize(() => this._loading.set(false)))
      .subscribe({
        next: (response) => {
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

  async createFolder(name: string): Promise<Result<Folder, ApiError>> {
    const result = await firstValueFrom(
      this.folderService.createFolder({ name: name, parentId: this._parentId() }).pipe(
        map((folder): Result<Folder, ApiError> => ({ ok: true, value: folder })),
        catchError((error) =>
          of<Result<Folder, ApiError>>({ ok: false, error: toApiError(error) }),
        ),
      ),
    );

    if (result.ok) {
      this._entries.update((current) => [result.value, ...current]);
    }

    return result;
  }

  // async download(entry: Folder | FileEntry): Promise<string> {
  //   const result = await firstValueFrom(this.fileService.getDownloadUrl(entry.id).pipe());
  // }
}
