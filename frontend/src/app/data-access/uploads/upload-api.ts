import { HttpClient, HttpEvent } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { FileEntry } from '../entries/entry-models';
import {
  CreateUploadIntentRequest,
  UploadIntentResponse,
  FileUploadRequest,
  UploadContentRequest,
} from './upload-models';

@Injectable({ providedIn: 'root' })
export class UploadApi {
  private readonly http = inject(HttpClient);

  createIntent(request: CreateUploadIntentRequest): Observable<UploadIntentResponse> {
    return this.http.post<UploadIntentResponse>('/api/uploads/presign', request);
  }

  createReplaceIntent(
    fileId: string,
    request: UploadContentRequest,
  ): Observable<UploadIntentResponse> {
    const encoded = encodeURIComponent(fileId);

    return this.http.post<UploadIntentResponse>(`/api/files/${encoded}/replacements`, request);
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
