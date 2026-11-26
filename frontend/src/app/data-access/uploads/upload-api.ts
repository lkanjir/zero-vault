import { HttpClient, HttpEvent } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { FileEntry } from '../entries/entry-models';
import {
  CompleteUploadRequest,
  CreateUploadIntentRequest,
  FileUploadRequest,
  PartUploadRequest,
  PresignUploadPartsRequest,
  PresignUploadPartsResponse,
  UploadContentRequest,
  UploadIntentResponse,
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

  presignParts(
    uploadId: string,
    request: PresignUploadPartsRequest,
  ): Observable<PresignUploadPartsResponse> {
    const encoded = encodeURIComponent(uploadId);

    return this.http.post<PresignUploadPartsResponse>(
      `/api/uploads/${encoded}/parts/presign`,
      request,
    );
  }

  upload(request: FileUploadRequest): Observable<HttpEvent<void>> {
    return this.http.put<void>(request.url, request.file, {
      headers: request.headers,
      observe: 'events',
      reportUploadProgress: true,
    });
  }

  uploadPart(request: PartUploadRequest): Observable<HttpEvent<void>> {
    return this.http.put<void>(request.url, request.body, {
      headers: request.headers,
      observe: 'events',
      reportUploadProgress: true,
    });
  }

  complete(uploadId: string, request?: CompleteUploadRequest): Observable<FileEntry> {
    const encoded = encodeURIComponent(uploadId);
    return this.http.post<FileEntry>(`/api/uploads/${encoded}/complete`, request ?? null);
  }

  abort(uploadId: string): Observable<void> {
    const encoded = encodeURIComponent(uploadId);
    return this.http.post<void>(`/api/uploads/${encoded}/abort`, null);
  }
}
