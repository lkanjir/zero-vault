import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { FolderService } from './folder-service';
import { EntryList } from './dto/entry';
import { catchError, finalize, firstValueFrom, map, of, Subscription } from 'rxjs';
import { EntryService } from './entry-service';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiError, apiErrorMessage, toApiError } from '../../shared/api-error';
import { Result } from '../../shared/result';
import { Folder } from './dto/folder';
import { FileService } from './file-service';
import {
  FileUploadRequest,
  UploadCompleteResponse,
  UploadIntentRequest,
  UploadIntentResponse,
} from './dto/upload';
import { calcualteSha256 } from '../../shared/util/sha256';

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

  async uploadFile(file: File): Promise<Result<UploadCompleteResponse, ApiError>> {
    const hash = await calcualteSha256(file);
    const parent = this._parentId();

    const intentRequest: UploadIntentRequest = {
      fileName: file.name,
      contentType: file.type,
      size: file.size,
      sha256: hash,
      parentFolder: parent,
    };

    const intentResult = await firstValueFrom(
      this.fileService.getPresignedUrl(intentRequest).pipe(
        map((intentResponse): Result<UploadIntentResponse, ApiError> => ({
          ok: true,
          value: intentResponse,
        })),
        catchError((error) =>
          of<Result<UploadIntentResponse, ApiError>>({ ok: false, error: toApiError(error) }),
        ),
      ),
    );

    if (!intentResult.ok) return intentResult;

    const objectStorageRequest: FileUploadRequest = {
      file: file,
      headers: {
        'Content-Type': intentResult.value.requiredHeaders['Content-Type'],
        'x-amz-checksum-sha256': intentResult.value.requiredHeaders['x-amz-checksum-sha256'],
      },
      url: intentResult.value.uploadUrl,
    };

    const uploadResult = await this.uploadToObjectStorage(objectStorageRequest);

    if (!uploadResult.ok) return uploadResult;

    const completionResult = await this.completeUpload(intentResult.value.uploadId);

    this.reload();

    return completionResult;
  }

  private async uploadToObjectStorage(
    request: FileUploadRequest,
  ): Promise<Result<boolean, ApiError>> {
    const result = await firstValueFrom(
      this.fileService.uploadFile(request).pipe(
        map((upload): Result<boolean, ApiError> => ({
          ok: true,
          value: true,
        })),
        catchError((error) =>
          of<Result<boolean, ApiError>>({ ok: false, error: toApiError(error) }),
        ),
      ),
    );

    return result;
  }

  private async completeUpload(
    uploadId: string,
  ): Promise<Result<UploadCompleteResponse, ApiError>> {
    const result = await firstValueFrom(
      this.fileService.completeRequest(uploadId).pipe(
        map((upload): Result<UploadCompleteResponse, ApiError> => ({
          ok: true,
          value: upload,
        })),
        catchError((error) =>
          of<Result<UploadCompleteResponse, ApiError>>({ ok: false, error: toApiError(error) }),
        ),
      ),
    );

    return result;
  }
}
