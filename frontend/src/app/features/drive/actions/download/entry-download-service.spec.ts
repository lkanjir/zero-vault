import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileEntry, FolderEntry } from '../../../../data-access/entries/entry-models';
import { EntryDownloadService, parseRetryAfterMs } from './entry-download-service';

const FILE_ENTRY: FileEntry = {
  kind: 'file',
  id: 'file-1',
  name: 'report.pdf',
  contentType: 'application/pdf',
  sizeBytes: 1024,
  updatedAt: '2026-07-28T10:00:00.000Z',
};

const FOLDER_ENTRY: FolderEntry = {
  kind: 'folder',
  id: 'folder-1',
  name: 'Projects',
  updatedAt: '2026-07-28T10:00:00.000Z',
};

describe('parseRetryAfterMs', () => {
  it('parses integer seconds and clamps into safe bounds', () => {
    expect(parseRetryAfterMs('5')).toBe(5_000);
    expect(parseRetryAfterMs('0')).toBe(1_000);
    expect(parseRetryAfterMs('120')).toBe(30_000);
  });

  it('parses HTTP-date values relative to current time', () => {
    const now = Date.parse('2026-07-28T10:00:00.000Z');
    expect(parseRetryAfterMs('Tue, 28 Jul 2026 10:00:07 GMT', now)).toBe(7_000);
    expect(parseRetryAfterMs('invalid-header', now)).toBeNull();
    expect(parseRetryAfterMs(null, now)).toBeNull();
  });
});

describe('EntryDownloadService', () => {
  let service: EntryDownloadService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T10:00:00.000Z'));

    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    service = TestBed.inject(EntryDownloadService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    try {
      httpTesting.verify();
    } finally {
      vi.useRealTimers();
      TestBed.resetTestingModule();
    }
  });

  it('returns the presigned URL for a file download', async () => {
    const promise = service.prepareDownload(FILE_ENTRY);

    const request = httpTesting.expectOne('/api/files/file-1/download-url');
    request.flush({
      fileId: 'file-1',
      fileName: 'report.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1024,
      downloadUrl: 'https://storage.example.test/file-1',
      expiresInSeconds: 60,
    });

    await expect(promise).resolves.toStrictEqual({
      ok: true,
      value: 'https://storage.example.test/file-1',
    });
  });

  it('polls folder download status honoring Retry-After headers until ready', async () => {
    const promise = service.prepareDownload(FOLDER_ENTRY);

    const createReq = httpTesting.expectOne('/api/folders/folder-1/downloads');
    createReq.flush(
      { downloadId: 'dl-1', fileName: 'Projects.zip', status: 'queued' },
      { status: 202, statusText: 'Accepted', headers: { 'Retry-After': '3' } },
    );

    await vi.advanceTimersByTimeAsync(2_999);
    httpTesting.expectNone('/api/folders/downloads/dl-1');

    await vi.advanceTimersByTimeAsync(1);
    const poll1 = httpTesting.expectOne('/api/folders/downloads/dl-1');
    poll1.flush(
      { downloadId: 'dl-1', fileName: 'Projects.zip', status: 'processing' },
      { headers: { 'Retry-After': '4' } },
    );

    await vi.advanceTimersByTimeAsync(3_999);
    httpTesting.expectNone('/api/folders/downloads/dl-1');

    await vi.advanceTimersByTimeAsync(1);
    const poll2 = httpTesting.expectOne('/api/folders/downloads/dl-1');
    poll2.flush({
      downloadId: 'dl-1',
      fileName: 'Projects.zip',
      status: 'ready',
      sizeBytes: 4096,
      expiresAt: '2026-07-28T11:00:00.000Z',
      downloadUrl: 'https://storage.example.test/projects.zip',
      expiresInSeconds: 60,
    });

    await expect(promise).resolves.toStrictEqual({
      ok: true,
      value: 'https://storage.example.test/projects.zip',
    });
  });

  it('stops polling and returns folder_download_timeout when the timeout expires', async () => {
    const promise = service.prepareDownload(FOLDER_ENTRY, { timeoutMs: 5_000 });

    const createReq = httpTesting.expectOne('/api/folders/folder-1/downloads');
    createReq.flush(
      { downloadId: 'dl-2', fileName: 'Projects.zip', status: 'queued' },
      { status: 202, statusText: 'Accepted', headers: { 'Retry-After': '3' } },
    );

    await vi.advanceTimersByTimeAsync(3_000);
    const poll1 = httpTesting.expectOne('/api/folders/downloads/dl-2');
    poll1.flush(
      { downloadId: 'dl-2', fileName: 'Projects.zip', status: 'processing' },
      { headers: { 'Retry-After': '3' } },
    );

    await vi.advanceTimersByTimeAsync(2_000);
    httpTesting.expectNone('/api/folders/downloads/dl-2');

    await expect(promise).resolves.toStrictEqual({
      ok: false,
      error: {
        status: -1,
        code: 'folder_download_timeout',
        message: 'Priprema arhive je predugo trajala. Pokušaj ponovno.',
      },
    });
  });

  it('cancels polling immediately when the AbortSignal aborts', async () => {
    const controller = new AbortController();
    const promise = service.prepareDownload(FOLDER_ENTRY, { signal: controller.signal });

    const createReq = httpTesting.expectOne('/api/folders/folder-1/downloads');
    createReq.flush(
      { downloadId: 'dl-3', fileName: 'Projects.zip', status: 'queued' },
      { status: 202, statusText: 'Accepted', headers: { 'Retry-After': '5' } },
    );

    await vi.advanceTimersByTimeAsync(1_000);
    controller.abort();

    await expect(promise).resolves.toStrictEqual({
      ok: false,
      error: { status: -1, code: 'download_cancelled' },
    });

    await vi.advanceTimersByTimeAsync(10_000);
    httpTesting.expectNone('/api/folders/downloads/dl-3');
  });

  it('returns folder_download_failed on terminal failed status', async () => {
    const promise = service.prepareDownload(FOLDER_ENTRY);

    const createReq = httpTesting.expectOne('/api/folders/folder-1/downloads');
    createReq.flush({ downloadId: 'dl-4', fileName: 'Projects.zip', status: 'queued' });
    await Promise.resolve();

    const poll1 = httpTesting.expectOne('/api/folders/downloads/dl-4');
    poll1.flush({ downloadId: 'dl-4', fileName: 'Projects.zip', status: 'failed' });

    await expect(promise).resolves.toStrictEqual({
      ok: false,
      error: { status: -1, code: 'folder_download_failed' },
    });
  });

  it('preserves HTTP API error payloads when download preparation fails', async () => {
    const promise = service.prepareDownload(FILE_ENTRY);

    const request = httpTesting.expectOne('/api/files/file-1/download-url');
    request.flush(
      { code: 'file_not_found', message: 'Datoteka ne postoji.' },
      { status: 404, statusText: 'Not Found' },
    );

    await expect(promise).resolves.toStrictEqual({
      ok: false,
      error: {
        status: 404,
        code: 'file_not_found',
        message: 'Datoteka ne postoji.',
        requestId: undefined,
      },
    });
  });
});
