import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { UploadRequest } from './dtos/upload.request';
import { Observable } from 'rxjs';
import { UploadCompleteResponse, UploadResponse } from './dtos/upload.response';

@Injectable({
  providedIn: 'root',
})
export class FilesApiService {
  private readonly http = inject(HttpClient)
  private readonly uploadUrlBase = 'http://localhost:3000/uploads'

  createPresignedUrl(request: UploadRequest) : Observable<UploadResponse>{
    return this.http.post<UploadResponse>(this.uploadUrlBase + '/presign', request);
  }

  uploadFile(objectUrl: string, file: File) : Observable<void>{
    return this.http.put<void>(objectUrl, file);
  } 

  completeUpload(uploadId: string) : Observable<UploadCompleteResponse> {
    return this.http.post<UploadCompleteResponse>(this.uploadUrlBase + `/${uploadId}/complete`, null);
  }
}
