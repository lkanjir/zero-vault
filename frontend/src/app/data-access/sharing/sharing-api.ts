import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  FileShare,
  FileShareList,
  SharedByMeFileList,
  SharedWithMeFileList,
  ShareFileAcceptedResponse,
  ShareFileRequest,
  UpdateFileShareRequest,
} from './sharing-models';
import { Observable } from 'rxjs';
import { CursorPageQuery } from '../../shared/cursor';

@Injectable({ providedIn: 'root' })
export class SharingApi {
  private readonly http = inject(HttpClient);

  getSharedWithMeFiles(params: CursorPageQuery): Observable<SharedWithMeFileList> {
    const httpParams = this.buildCursorParams(params);
    return this.http.get<SharedWithMeFileList>('/api/files/shared-with-me', { params: httpParams });
  }

  shareFile(fileId: string, request: ShareFileRequest): Observable<ShareFileAcceptedResponse> {
    const encoded = encodeURIComponent(fileId);
    return this.http.post<ShareFileAcceptedResponse>(`/api/files/${encoded}/shares`, request);
  }

  getFileShares(fileId: string, query: CursorPageQuery): Observable<FileShareList> {
    const params = this.buildCursorParams(query);
    const encoded = encodeURIComponent(fileId);

    return this.http.get<FileShareList>(`/api/files/${encoded}/shares`, { params });
  }

  updateFileShare(
    fileId: string,
    shareId: string,
    request: UpdateFileShareRequest,
  ): Observable<FileShare> {
    const encodedFileId = encodeURIComponent(fileId);
    const encodedShareId = encodeURIComponent(shareId);

    return this.http.patch<FileShare>(
      `/api/files/${encodedFileId}/shares/${encodedShareId}`,
      request,
    );
  }

  revokeFileShare(fileId: string, shareId: string): Observable<void> {
    const encodedFileId = encodeURIComponent(fileId);
    const encodedShareId = encodeURIComponent(shareId);

    return this.http.delete<void>(`/api/files/${encodedFileId}/shares/${encodedShareId}`);
  }

  getSharedByMeFiles(query: CursorPageQuery): Observable<SharedByMeFileList> {
    const params = this.buildCursorParams(query);
    return this.http.get<SharedByMeFileList>('/api/files/shared-by-me', { params });
  }

  private buildCursorParams(query: CursorPageQuery): HttpParams {
    let httpParams = new HttpParams().set('limit', query.limit);
    if (query.cursor !== null) {
      httpParams = httpParams.set('cursor', query.cursor);
    }

    return httpParams;
  }
}
