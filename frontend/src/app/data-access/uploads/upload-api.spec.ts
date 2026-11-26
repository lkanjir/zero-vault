import { HttpEventType, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, lastValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UploadApi } from './upload-api';

describe('UploadApi', () => {
  let api: UploadApi;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    api = TestBed.inject(UploadApi);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
    TestBed.resetTestingModule();
  });

  it('posts multipart part presign batches to /api/uploads/:uploadId/parts/presign', async () => {
    const promise = firstValueFrom(
      api.presignParts('upload-1', {
        parts: [{ partNumber: 1, sha256: 'a'.repeat(64) }],
      }),
    );

    const req = httpTesting.expectOne('/api/uploads/upload-1/parts/presign');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toStrictEqual({
      parts: [{ partNumber: 1, sha256: 'a'.repeat(64) }],
    });
    req.flush({
      uploadId: 'upload-1',
      parts: [
        {
          partNumber: 1,
          uploadUrl: 'https://storage.example.test/part-1',
          expiresInSeconds: 900,
          requiredHeaders: { 'x-amz-checksum-sha256': 'base64==' },
        },
      ],
    });

    await expect(promise).resolves.toMatchObject({ uploadId: 'upload-1' });
  });

  it('uploads raw part buffers with checksum header and exposes response ETag', async () => {
    const buffer = new Uint8Array([1, 2, 3, 4]).buffer;
    const promise = lastValueFrom(
      api.uploadPart({
        url: 'https://storage.example.test/part-1',
        body: buffer,
        headers: { 'x-amz-checksum-sha256': 'base64==' },
      }),
    );

    const req = httpTesting.expectOne('https://storage.example.test/part-1');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toBe(buffer);
    expect(req.request.headers.get('x-amz-checksum-sha256')).toBe('base64==');
    expect(req.request.reportUploadProgress).toBe(true);
    req.flush(null, { status: 200, statusText: 'OK', headers: { ETag: '"part-etag-1"' } });

    const finalEvent = await promise;
    expect(finalEvent.type).toBe(HttpEventType.Response);
    if (finalEvent.type === HttpEventType.Response) {
      expect(finalEvent.headers.get('ETag')).toBe('"part-etag-1"');
    }
  });

  it('posts multipart completion parts and abort requests to the upload endpoints', async () => {
    const completePromise = firstValueFrom(
      api.complete('upload-1', {
        parts: [{ partNumber: 1, etag: '"etag-1"', sha256: 'a'.repeat(64) }],
      }),
    );

    const completeReq = httpTesting.expectOne('/api/uploads/upload-1/complete');
    expect(completeReq.request.method).toBe('POST');
    expect(completeReq.request.body).toStrictEqual({
      parts: [{ partNumber: 1, etag: '"etag-1"', sha256: 'a'.repeat(64) }],
    });
    completeReq.flush({
      kind: 'file',
      id: 'file-1',
      name: 'large.bin',
      contentType: 'application/octet-stream',
      sizeBytes: 32 * 1024 * 1024,
      updatedAt: '2026-08-08T11:00:00.000Z',
    });

    await expect(completePromise).resolves.toMatchObject({ id: 'file-1' });

    const abortPromise = firstValueFrom(api.abort('upload-1'));
    const abortReq = httpTesting.expectOne('/api/uploads/upload-1/abort');
    expect(abortReq.request.method).toBe('POST');
    abortReq.flush(null, { status: 204, statusText: 'No Content' });
    await expect(abortPromise).resolves.toBeNull();
  });
});
