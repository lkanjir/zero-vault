import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  CreateFolderDownloadResponse,
  CreateFolderRequest,
  FolderDownloadStatusResponse,
} from './folder-models';
import { FolderEntry } from '../entries/entry-models';

@Injectable({ providedIn: 'root' })
export class FolderApi {
  private readonly http = inject(HttpClient);

  createFolder(request: CreateFolderRequest): Observable<FolderEntry> {
    return this.http.post<FolderEntry>('/api/folders', request);
  }

  createDownload(folderId: string): Observable<CreateFolderDownloadResponse> {
    const encoded = encodeURIComponent(folderId);
    return this.http.post<CreateFolderDownloadResponse>(`/api/folders/${encoded}/downloads`, null);
  }

  getDownloadStatus(downloadId: string): Observable<FolderDownloadStatusResponse> {
    const encoded = encodeURIComponent(downloadId);
    return this.http.get<FolderDownloadStatusResponse>(`/api/folders/downloads/${encoded}`);
  }
}
