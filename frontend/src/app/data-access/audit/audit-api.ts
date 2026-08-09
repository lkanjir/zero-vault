import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { AuditEventList, AuditEventQuery, AuditStatistics } from './audit-model';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AuditApi {
  private readonly http = inject(HttpClient);

  getEvents(query: AuditEventQuery): Observable<AuditEventList> {
    let params = new HttpParams().set('limit', query.limit);

    if (query.cursor !== null) {
      params = params.set('cursor', query.cursor);
    }

    if (query.search !== null) {
      params = params.set('search', query.search);
    }

    return this.http.get<AuditEventList>('/api/audit/events', { params });
  }

  getStatistics(): Observable<AuditStatistics> {
    return this.http.get<AuditStatistics>('/api/audit/statistics');
  }
}
