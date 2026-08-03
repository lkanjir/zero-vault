import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { SharedFileList, SharedFileListParams } from './sharing-models';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class SharingApi {
  private readonly http = inject(HttpClient);

  getSharedFiles(params: SharedFileListParams): Observable<SharedFileList> {
    let httpParams = new HttpParams().set('limit', params.limit);
    if (params.cursor !== null) {
      httpParams = httpParams.set('cursor', params.cursor);
    }

    return this.http.get<SharedFileList>('/api/files/shared-with-me', { params: httpParams });
  }
}
