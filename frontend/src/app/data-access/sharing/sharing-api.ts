import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  FileShare,
  FileShareList,
  SharedFileList,
  ShareFileAcceptedResponse,
  ShareFileRequest,
  UpdateFileShareRequest,
} from './sharing-models';
import { Observable } from 'rxjs';
import { CursorPageQuery } from '../../shared/cursor';

@Injectable({ providedIn: 'root' })
export class SharingApi {
  private readonly http = inject(HttpClient);

  getSharedFiles(params: CursorPageQuery): Observable<SharedFileList> {
    const httpParams = this.buildCursorParams(params);
    return this.http.get<SharedFileList>('/api/files/shared-with-me', { params: httpParams });
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

  private buildCursorParams(query: CursorPageQuery): HttpParams {
    let httpParams = new HttpParams().set('limit', query.limit);
    if (query.cursor !== null) {
      httpParams = httpParams.set('cursor', query.cursor);
    }

    return httpParams;
  }
}
