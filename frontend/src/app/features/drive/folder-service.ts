import { HttpClient } from '@angular/common/http';
import { inject, Injectable, Service } from '@angular/core';
import { Observable } from 'rxjs';
import { FolderEntry } from './dto/folder';
import { CreateFolderRequest } from './create-folder-request';

@Injectable({ providedIn: 'root' })
export class FolderService {
  private readonly http = inject(HttpClient);

  createFolder(request: CreateFolderRequest): Observable<FolderEntry> {
    return this.http.post<FolderEntry>('/api/folders', request);
  }
}
