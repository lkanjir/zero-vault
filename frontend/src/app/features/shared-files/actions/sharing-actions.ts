import { inject, Injectable } from '@angular/core';
import { SharingApi } from '../../../data-access/sharing/sharing-api';
import { ShareFileRequest } from '../../../data-access/sharing/sharing-models';
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
}
