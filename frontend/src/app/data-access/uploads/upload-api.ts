import { HttpClient, HttpEvent } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { FileEntry } from '../entries/entry-models';
import { UploadIntentRequest, UploadIntentResponse, FileUploadRequest } from './upload-models';


@Injectable({ providedIn: 'root' })
export class UploadApi {
  private readonly http = inject(HttpClient);

  createIntent(request: UploadIntentRequest): Observable<UploadIntentResponse> {
    return this.http.post<UploadIntentResponse>('/api/uploads/presign', request);
  }

  upload(request: FileUploadRequest): Observable<HttpEvent<void>> {
    return this.http.put<void>(request.url, request.file, {
      headers: request.headers,
      observe: 'events',
      reportUploadProgress: true,
    });
  }

  complete(uploadId: string): Observable<FileEntry> {
    const encoded = encodeURIComponent(uploadId);
    return this.http.post<FileEntry>(`/api/uploads/${encoded}/complete`, null);
  }
}
