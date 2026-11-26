import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DriveStore } from './drive-store';

describe('DriveStore', () => {
  let store: DriveStore;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    store = TestBed.inject(DriveStore);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    try {
      httpTesting.verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('cancels in-flight requests and resets all state on reset()', () => {
    store.loadFolder('folder-1');
    const inFlight = httpTesting.expectOne((req) => req.url === '/api/entries');
    expect(store.loading()).toBe(true);
    expect(store.parentId()).toBe('folder-1');

    store.reset();

    expect(inFlight.cancelled).toBe(true);
    expect(store.loading()).toBe(false);
    expect(store.parentId()).toBeNull();
    expect(store.entries()).toStrictEqual([]);
    expect(store.path()).toStrictEqual([]);
    expect(store.search()).toBeNull();
    expect(store.kind()).toBeNull();
    expect(store.sort()).toBe('name-asc');
  });

  it('does not trigger background reloads after reset() when inactive', () => {
    store.loadFolder(null);
    const initialReq = httpTesting.expectOne((req) => req.url === '/api/entries');
    initialReq.flush({
      items: [],
      path: [],
      page: { hasMore: false, limit: 50, nextCursor: null },
    });

    store.setSearch('report');
    const searchReq = httpTesting.expectOne((req) => req.url === '/api/entries');
    searchReq.flush({
      items: [],
      path: [],
      page: { hasMore: false, limit: 50, nextCursor: null },
    });
    expect(store.search()).toBe('report');

    store.reset();
    store.reloadIfCurrent(null);
    store.reload();

    httpTesting.expectNone((req) => req.url === '/api/entries');
    expect(store.search()).toBeNull();
  });

  it('cancels loadMore subscription on reset()', () => {
    store.loadFolder(null);
    const firstReq = httpTesting.expectOne((req) => req.url === '/api/entries');
    firstReq.flush({
      items: [
        {
          kind: 'file',
          id: 'file-1',
          name: 'doc.txt',
          contentType: 'text/plain',
          sizeBytes: 10,
          updatedAt: '2026-07-28T10:00:00.000Z',
          access: {
            canDelete: true,
            canDownload: true,
            canMove: true,
            canRename: true,
            canReplace: true,
            canShare: true,
          },
        },
      ],
      path: [],
      page: { hasMore: true, limit: 50, nextCursor: 'cursor-1' },
    });

    store.loadMore();
    const loadMoreReq = httpTesting.expectOne((req) => req.url === '/api/entries');
    expect(store.loadingMore()).toBe(true);

    store.reset();

    expect(loadMoreReq.cancelled).toBe(true);
    expect(store.loadingMore()).toBe(false);
    expect(store.hasMore()).toBe(false);
    expect(store.nextCursor()).toBeNull();
  });
});
