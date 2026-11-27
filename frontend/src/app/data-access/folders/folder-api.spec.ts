import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderApi } from './folder-api';

describe('FolderApi', () => {
  let api: FolderApi;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    api = TestBed.inject(FolderApi);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
    TestBed.resetTestingModule();
  });

  it('posts batch folder tree requests to /api/folders/tree and returns the folder map', async () => {
    const responsePromise = firstValueFrom(
      api.ensureFolderTree({
        parentId: 'parent-1',
        paths: ['Photos', 'Photos/2026'],
      }),
    );

    const req = httpTesting.expectOne('/api/folders/tree');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toStrictEqual({
      parentId: 'parent-1',
      paths: ['Photos', 'Photos/2026'],
    });

    req.flush({
      folders: {
        Photos: 'folder-photos',
        'Photos/2026': 'folder-2026',
      },
    });

    await expect(responsePromise).resolves.toStrictEqual({
      folders: {
        Photos: 'folder-photos',
        'Photos/2026': 'folder-2026',
      },
    });
  });
});
