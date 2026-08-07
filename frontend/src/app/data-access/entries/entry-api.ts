import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { EntryList, EntryRequestParams, EntryResponse, EntryUpdateRequest } from './entry-models';

@Injectable({
  providedIn: 'root',
})
export class EntryApi {
  private readonly http = inject(HttpClient);

  getEntries(params: EntryRequestParams): Observable<EntryList> {
    let httpParams = new HttpParams().set('limit', params.limit).set('sort', params.sort);

    if (params.parentId !== null) {
      httpParams = httpParams.set('parentId', params.parentId);
    }

    if (params.cursor !== null) {
      httpParams = httpParams.set('cursor', params.cursor);
    }

    if (params.search !== null) {
      httpParams = httpParams.set('search', params.search);
    }

    if (params.kind !== null) {
      httpParams = httpParams.set('kind', params.kind);
    }

    return this.http.get<EntryList>('/api/entries', { params: httpParams });
  }

  updateEntry(entryId: string, request: EntryUpdateRequest): Observable<EntryResponse> {
    const encoded = encodeURIComponent(entryId);
    return this.http.patch<EntryResponse>(`/api/entries/${encoded}`, request);
  }

  deleteEntry(entryId: string): Observable<void> {
    const encoded = encodeURIComponent(entryId);
    return this.http.delete<void>(`/api/entries/${encoded}`);
  }
}
