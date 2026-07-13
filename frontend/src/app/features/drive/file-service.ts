import { HttpClient } from '@angular/common/http';
import { inject, Inject, Injectable, Service } from '@angular/core';
import {
  FileUploadRequest,
  UploadCompleteResponse,
  UploadIntentRequest,
  UploadIntentResponse,
} from './dto/upload';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class FileService {
  private readonly http = inject(HttpClient);

  getPresignedUrl(request: UploadIntentRequest): Observable<UploadIntentResponse> {
    return this.http.post<UploadIntentResponse>('/api/uploads/presign', request);
  }

  uploadFile(request: FileUploadRequest): Observable<void> {
    return this.http.put<void>(request.url, request.file, {
      headers: request.headers,
    });
  }

  completeRequest(fileId: string): Observable<UploadCompleteResponse> {
    const encoded = encodeURIComponent(fileId);
    return this.http.post<UploadCompleteResponse>(`/api/uploads/${encoded}/complete`, null);
  }
}
