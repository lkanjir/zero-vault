import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { SharingApi } from '../../../data-access/sharing/sharing-api';
import { SharedFile } from '../../../data-access/sharing/sharing-models';

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
}
