import { inject, Injectable } from '@angular/core';
import { EntryApi } from '../../../data-access/entries/entry-api';
import { FolderApi } from '../../../data-access/folders/folder-api';
import { firstValueFrom, map, catchError, of } from 'rxjs';
import { EntryResponse, FolderEntry } from '../../../data-access/entries/entry-models';
import { ApiError, toApiError } from '../../../shared/api-error';
import { Result } from '../../../shared/result';
import { DriveStore } from '../state/drive-store';

export type MoveEntryCommand = {
  entryId: string;
  sourceParentId: string | null;
  targetParentId: string | null;
}

@Injectable({ providedIn: 'root' })
export class EntryActions {
  private readonly entryApi = inject(EntryApi);
  private readonly folderApi = inject(FolderApi);
  private readonly store = inject(DriveStore);

  async createFolder(name: string): Promise<Result<FolderEntry, ApiError>> {
    const targetParentId = this.store.parentId();

    const result = await firstValueFrom(
      this.folderApi.createFolder({ name: name, parentId: targetParentId }).pipe(
        map((folder): Result<FolderEntry, ApiError> => ({ ok: true, value: folder })),
        catchError((error) =>
          of<Result<FolderEntry, ApiError>>({ ok: false, error: toApiError(error) }),
        ),
      ),
    );

    if (result.ok) {
      this.store.reloadIfCurrent(targetParentId);
    }

    return result;
  }

  async renameEntry(entryId: string, name: string): Promise<Result<EntryResponse, ApiError>> {
    const sourceParentId = this.store.parentId();

    const result = await firstValueFrom(
      this.entryApi.updateEntry(entryId, { name }).pipe(
        map((updatedEntry): Result<EntryResponse, ApiError> => ({
          ok: true,
          value: updatedEntry,
        })),
        catchError((error) =>
          of<Result<EntryResponse, ApiError>>({ ok: false, error: toApiError(error) }),
        ),
      ),
    );

    if (result.ok) {
      this.store.reloadIfCurrent(sourceParentId);
    }

    return result;
  }

  async moveEntry(
    command: MoveEntryCommand
  ): Promise<Result<EntryResponse, ApiError>> {
    const result = await firstValueFrom(
      this.entryApi.updateEntry(command.entryId, { parentId: command.targetParentId }).pipe(
        map((updatedEntry): Result<EntryResponse, ApiError> => ({
          ok: true,
          value: updatedEntry,
        })),
        catchError((error) =>
          of<Result<EntryResponse, ApiError>>({ ok: false, error: toApiError(error) }),
        ),
      ),
    );

    if (result.ok) {
      this.store.reloadIfCurrent(command.sourceParentId);

      if (command.targetParentId !== command.sourceParentId) {
        this.store.reloadIfCurrent(command.targetParentId);
      }
    }

    return result;
  }
}
