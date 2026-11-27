import { HttpClient, HttpResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  CreateFolderDownloadResponse,
  CreateFolderRequest,
  EnsureFolderTreeRequest,
  EnsureFolderTreeResponse,
  FolderDownloadStatusResponse,
} from './folder-models';
import { FolderEntry } from '../entries/entry-models';

@Injectable({ providedIn: 'root' })
export class FolderApi {
  private readonly http = inject(HttpClient);

  createFolder(request: CreateFolderRequest): Observable<FolderEntry> {
    return this.http.post<FolderEntry>('/api/folders', request);
  }

  ensureFolderTree(request: EnsureFolderTreeRequest): Observable<EnsureFolderTreeResponse> {
    return this.http.post<EnsureFolderTreeResponse>('/api/folders/tree', request);
  }

  createDownload(folderId: string): Observable<HttpResponse<CreateFolderDownloadResponse>> {
    const encoded = encodeURIComponent(folderId);
    return this.http.post<CreateFolderDownloadResponse>(`/api/folders/${encoded}/downloads`, null, {
      observe: 'response',
    });
  }

  getDownloadStatus(downloadId: string): Observable<HttpResponse<FolderDownloadStatusResponse>> {
    const encoded = encodeURIComponent(downloadId);
    return this.http.get<FolderDownloadStatusResponse>(`/api/folders/downloads/${encoded}`, {
      observe: 'response',
    });
  }
}
