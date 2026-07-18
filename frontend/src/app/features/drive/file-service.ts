import { HttpClient, HttpEvent } from '@angular/common/http';
import { inject, Inject, Injectable, Service } from '@angular/core';
import { FileUploadRequest, UploadIntentRequest, UploadIntentResponse } from './dto/upload';
import { Observable } from 'rxjs';
import { FileEntry } from './dto/file';

@Injectable({ providedIn: 'root' })
export class FileService {
  private readonly http = inject(HttpClient);

  getPresignedUrl(request: UploadIntentRequest): Observable<UploadIntentResponse> {
    return this.http.post<UploadIntentResponse>('/api/uploads/presign', request);
  }

  uploadFile(request: FileUploadRequest): Observable<HttpEvent<void>> {
    return this.http.put<void>(request.url, request.file, {
      headers: request.headers,
      observe: 'events',
      reportUploadProgress: true,
    });
  }

  completeRequest(uploadId: string): Observable<FileEntry> {
    const encoded = encodeURIComponent(uploadId);
    return this.http.post<FileEntry>(`/api/uploads/${encoded}/complete`, null);
  }
}
