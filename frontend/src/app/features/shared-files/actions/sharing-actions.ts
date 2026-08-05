import { inject, Injectable } from '@angular/core';
import { SharingApi } from '../../../data-access/sharing/sharing-api';
import {
  FileShare,
  ShareFileRequest,
  UpdateFileShareRequest,
} from '../../../data-access/sharing/sharing-models';
import { Result } from '../../../shared/result';
import { ApiError, toApiError } from '../../../shared/api-error';
import { catchError, firstValueFrom, map, of } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class SharingActions {
  private readonly sharingApi = inject(SharingApi);

  async shareFile(fileId: string, request: ShareFileRequest): Promise<Result<void, ApiError>> {
    return firstValueFrom(
      this.sharingApi.shareFile(fileId, request).pipe(
        map((): Result<void, ApiError> => ({ ok: true, value: undefined })),
        catchError((error) => of<Result<void, ApiError>>({ ok: false, error: toApiError(error) })),
      ),
    );
  }

  async updateFileShare(
    fileId: string,
    shareId: string,
    request: UpdateFileShareRequest,
  ): Promise<Result<FileShare, ApiError>> {
    return firstValueFrom(
      this.sharingApi.updateFileShare(fileId, shareId, request).pipe(
        map((share): Result<FileShare, ApiError> => ({ ok: true, value: share })),
        catchError((error) =>
          of<Result<FileShare, ApiError>>({ ok: false, error: toApiError(error) }),
        ),
      ),
    );
  }

  async revokeFileShare(fileId: string, shareId: string): Promise<Result<void, ApiError>> {
    return firstValueFrom(
      this.sharingApi.revokeFileShare(fileId, shareId).pipe(
        map((): Result<void, ApiError> => ({ ok: true, value: undefined })),
        catchError((error) => of<Result<void, ApiError>>({ ok: false, error: toApiError(error) })),
      ),
    );
  }
}
