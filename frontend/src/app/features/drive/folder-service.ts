import { HttpClient } from '@angular/common/http';
import { inject, Injectable, Service } from '@angular/core';
import { Observable } from 'rxjs';
import { Folder } from './dto/folder';
import { CreateFolderRequest } from './create-folder-request';

@Injectable({ providedIn: 'root' })
export class FolderService {
  private readonly http = inject(HttpClient);

  createFolder(request: CreateFolderRequest): Observable<Folder> {
    return this.http.post<Folder>('/api/folders', request);
  }
}
