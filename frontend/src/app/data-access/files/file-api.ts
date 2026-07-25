import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { FileDownloadResponse } from './file-models';

@Injectable({ providedIn: 'root' })
export class FileApi {
  private readonly http = inject(HttpClient);

  getDownloadUrl(fileId: string): Observable<FileDownloadResponse> {
    const encoded = encodeURIComponent(fileId);
    return this.http.post<FileDownloadResponse>(`/api/files/${encoded}/download-url`, null);
  }
}
