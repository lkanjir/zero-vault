import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import {UploadUrlRequest, UploadUrlResponse} from './types';

@Injectable({
  providedIn: 'root',
})
export class UploadService {
  private readonly http = inject(HttpClient);

  createPresignedUrl(request: UploadUrlRequest) : Observable<UploadUrlResponse> {
    return this.http.post<UploadUrlResponse>("/uploads/presign", request);
  }

  upload(url: string, file: File) : Observable<void>{
    return this.http.put<void>(url,file, {
      headers: {
        'Content-Type' : 'text/plain'
      }
    })
  }  
}
