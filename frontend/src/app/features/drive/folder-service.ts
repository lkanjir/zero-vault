import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { CreateFolderRequest } from './create-folder-request';
import { CreateFolderDownloadResponse, FolderDownloadStatusResponse } from './dto/folder-download';
import { FolderEntry } from '../../data-access/entries/entry-models';

@Injectable({ providedIn: 'root' })
export class FolderService {
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
