import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { EntryList } from './dto/entry';
import { EntryRequestParams } from './entry-request-params';

@Injectable({
  providedIn: 'root',
})
export class EntryService {
  private readonly http = inject(HttpClient);

  getEntries(params: EntryRequestParams): Observable<EntryList> {
    let httpParams = new HttpParams().set('limit', params.limit);

    if (params.parentId !== null) {
      httpParams.set('parentId', params.parentId);
    }

    if (params.cursor !== null) {
      httpParams.set('cursor', params.cursor);
    }

    return this.http.get<EntryList>('/api/entries', { params: httpParams });
  }
}
