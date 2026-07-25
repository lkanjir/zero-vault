import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { FileDownloadResponse } from '../dto/file';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class FileApi {
  private readonly http = inject(HttpClient);

  getDownloadUrl(fileId: string): Observable<FileDownloadResponse> {
    const encoded = encodeURIComponent(fileId);
    return this.http.post<FileDownloadResponse>(`/api/files/${encoded}/download-url`, null);
  }
}
