import { HttpEventType, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateBufferSha256 } from '../../shared/util/sha256';
import { UploadCancelledError, UploadExecutor, UploadProgressSnapshot } from './upload-executor';

const realSetTimeout = globalThis.setTimeout.bind(globalThis);

describe('UploadExecutor', () => {
  let executor: UploadExecutor;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    executor = TestBed.inject(UploadExecutor);
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

  it('uploads multipart batches in parallel, aggregates progress, and returns part ETags and SHA-256s', async () => {
    // 4 small parts using custom partSizeBytes=4 so unit test stays fast while exercising batch 1 (3 parts) + batch 2 (1 part)
    const content = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    const file = new File([content], 'chunked.bin', { type: 'application/octet-stream' });
    const expectedPartHashes = await Promise.all([
      calculateBufferSha256(content.slice(0, 4).buffer),
      calculateBufferSha256(content.slice(4, 8).buffer),
      calculateBufferSha256(content.slice(8, 12).buffer),
      calculateBufferSha256(content.slice(12, 14).buffer),
    ]);
    const snapshots: UploadProgressSnapshot[] = [];
    const controller = new AbortController();

    const uploadPromise = executor.uploadMultipart({
      file,
      intent: {
        uploadMode: 'multipart',
        uploadId: 'upload-mp-1',
        partSizeBytes: 4,
        partCount: 4,
        finalizeDeadline: '2026-08-10T11:00:00.000Z',
      },
      signal: controller.signal,
      onProgress: (snapshot) => snapshots.push(snapshot),
    });

    // Wait for batch 1 slicing + WebCrypto hashing to issue presignParts
    const presign1 = await waitForRequest(httpTesting, '/api/uploads/upload-mp-1/parts/presign');
    expect(presign1.request.body).toStrictEqual({
      parts: [
        { partNumber: 1, sha256: expectedPartHashes[0] },
        { partNumber: 2, sha256: expectedPartHashes[1] },
        { partNumber: 3, sha256: expectedPartHashes[2] },
      ],
    });
    presign1.flush({
      uploadId: 'upload-mp-1',
      parts: [1, 2, 3].map((partNumber) => ({
        partNumber,
        uploadUrl: `https://storage.example.test/part-${partNumber}`,
        expiresInSeconds: 900,
        requiredHeaders: { 'x-amz-checksum-sha256': `b64-${partNumber}` },
      })),
    });

    // All 3 parts in batch 1 are in flight concurrently
    const [req1, req2, req3] = await Promise.all([
      waitForRequest(httpTesting, 'https://storage.example.test/part-1'),
      waitForRequest(httpTesting, 'https://storage.example.test/part-2'),
      waitForRequest(httpTesting, 'https://storage.example.test/part-3'),
    ]);

    req1.event({ type: HttpEventType.UploadProgress, loaded: 2, total: 4 });
    req2.event({ type: HttpEventType.UploadProgress, loaded: 4, total: 4 });
    req1.flush(null, { status: 200, statusText: 'OK', headers: { ETag: '"etag-1"' } });
    req2.flush(null, { status: 200, statusText: 'OK', headers: { ETag: '"etag-2"' } });
    req3.flush(null, { status: 200, statusText: 'OK', headers: { ETag: '"etag-3"' } });

    // Batch 2 (part 4)
    const presign2 = await waitForRequest(httpTesting, '/api/uploads/upload-mp-1/parts/presign');
    expect(presign2.request.body).toStrictEqual({
      parts: [{ partNumber: 4, sha256: expectedPartHashes[3] }],
    });
    presign2.flush({
      uploadId: 'upload-mp-1',
      parts: [
        {
          partNumber: 4,
          uploadUrl: 'https://storage.example.test/part-4',
          expiresInSeconds: 900,
          requiredHeaders: { 'x-amz-checksum-sha256': 'b64-4' },
        },
      ],
    });

    const req4 = await waitForRequest(httpTesting, 'https://storage.example.test/part-4');
    req4.flush(null, { status: 200, statusText: 'OK', headers: { ETag: '"etag-4"' } });

    const parts = await uploadPromise;
    expect(parts).toStrictEqual([
      { partNumber: 1, etag: '"etag-1"', sha256: expectedPartHashes[0] },
      { partNumber: 2, etag: '"etag-2"', sha256: expectedPartHashes[1] },
      { partNumber: 3, etag: '"etag-3"', sha256: expectedPartHashes[2] },
      { partNumber: 4, etag: '"etag-4"', sha256: expectedPartHashes[3] },
    ]);
    expect(snapshots.at(-1)?.progress).toBe(100);
  });

  it('retries a transient 503 failure and re-presigns a part after 403 expiration', async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4, 5, 6])], 'retry.bin', {
      type: 'application/octet-stream',
    });
    const controller = new AbortController();

    const uploadPromise = executor.uploadMultipart({
      file,
      intent: {
        uploadMode: 'multipart',
        uploadId: 'upload-retry',
        partSizeBytes: 3,
        partCount: 2,
        finalizeDeadline: '2026-08-10T11:00:00.000Z',
      },
      signal: controller.signal,
      onProgress: () => undefined,
    });

    const initialPresign = await waitForRequest(
      httpTesting,
      '/api/uploads/upload-retry/parts/presign',
    );
    initialPresign.flush({
      uploadId: 'upload-retry',
      parts: [
        {
          partNumber: 1,
          uploadUrl: 'https://storage.example.test/p1-v1',
          expiresInSeconds: 900,
          requiredHeaders: { 'x-amz-checksum-sha256': 'b64-1' },
        },
        {
          partNumber: 2,
          uploadUrl: 'https://storage.example.test/p2-v1',
          expiresInSeconds: 900,
          requiredHeaders: { 'x-amz-checksum-sha256': 'b64-2' },
        },
      ],
    });

    const [p1Attempt1, p2Attempt1] = await Promise.all([
      waitForRequest(httpTesting, 'https://storage.example.test/p1-v1'),
      waitForRequest(httpTesting, 'https://storage.example.test/p2-v1'),
    ]);

    // Part 1 fails with 503 (transient), Part 2 fails with 403 (expired URL)
    p1Attempt1.flush(null, { status: 503, statusText: 'Service Unavailable' });
    p2Attempt1.flush(null, { status: 403, statusText: 'Forbidden' });

    await vi.advanceTimersByTimeAsync(500);

    // Part 1 retries same URL; Part 2 refreshes presigned URL first
    const p1Attempt2 = await waitForRequest(httpTesting, 'https://storage.example.test/p1-v1');
    const p2Refresh = await waitForRequest(httpTesting, '/api/uploads/upload-retry/parts/presign');
    p2Refresh.flush({
      uploadId: 'upload-retry',
      parts: [
        {
          partNumber: 2,
          uploadUrl: 'https://storage.example.test/p2-v2',
          expiresInSeconds: 900,
          requiredHeaders: { 'x-amz-checksum-sha256': 'b64-2' },
        },
      ],
    });

    const p2Attempt2 = await waitForRequest(httpTesting, 'https://storage.example.test/p2-v2');
    p1Attempt2.flush(null, { status: 200, statusText: 'OK', headers: { ETag: '"etag-1"' } });
    p2Attempt2.flush(null, { status: 200, statusText: 'OK', headers: { ETag: '"etag-2"' } });

    const parts = await uploadPromise;
    expect(parts.map((part) => part.etag)).toStrictEqual(['"etag-1"', '"etag-2"']);
  });

  it('cancels in-flight part requests immediately when the signal aborts without emitting backwards progress', async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4, 5, 6])], 'cancel.bin', {
      type: 'application/octet-stream',
    });
    const controller = new AbortController();
    const snapshots: UploadProgressSnapshot[] = [];

    const uploadPromise = executor.uploadMultipart({
      file,
      intent: {
        uploadMode: 'multipart',
        uploadId: 'upload-cancel',
        partSizeBytes: 3,
        partCount: 2,
        finalizeDeadline: '2026-08-10T11:00:00.000Z',
      },
      signal: controller.signal,
      onProgress: (snapshot) => snapshots.push(snapshot),
    });

    const presign = await waitForRequest(httpTesting, '/api/uploads/upload-cancel/parts/presign');
    presign.flush({
      uploadId: 'upload-cancel',
      parts: [
        {
          partNumber: 1,
          uploadUrl: 'https://storage.example.test/c1',
          expiresInSeconds: 900,
          requiredHeaders: { 'x-amz-checksum-sha256': 'b64-1' },
        },
        {
          partNumber: 2,
          uploadUrl: 'https://storage.example.test/c2',
          expiresInSeconds: 900,
          requiredHeaders: { 'x-amz-checksum-sha256': 'b64-2' },
        },
      ],
    });

    const [req1, req2] = await Promise.all([
      waitForRequest(httpTesting, 'https://storage.example.test/c1'),
      waitForRequest(httpTesting, 'https://storage.example.test/c2'),
    ]);

    req1.event({ type: HttpEventType.UploadProgress, loaded: 3, total: 3 });
    expect(snapshots.at(-1)?.progress).toBe(50);
    const snapshotCountBeforeAbort = snapshots.length;

    controller.abort();

    await expect(uploadPromise).rejects.toBeInstanceOf(UploadCancelledError);
    expect(req1.cancelled).toBe(true);
    expect(req2.cancelled).toBe(true);
    expect(snapshots).toHaveLength(snapshotCountBeforeAbort);
  });

  it('uploads a 0-byte single-part file cleanly without NaN progress', async () => {
    const file = new File([], 'empty.txt', { type: 'text/plain' });
    const snapshots: UploadProgressSnapshot[] = [];
    const controller = new AbortController();

    const uploadPromise = executor.uploadSinglePart({
      file,
      intent: {
        uploadMode: 'single',
        uploadId: 'upload-empty',
        uploadUrl: 'https://storage.example.test/empty',
        expiresInSeconds: 600,
        requiredHeaders: {
          'Content-Type': 'text/plain',
          'x-amz-checksum-sha256': '47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=',
        },
      },
      signal: controller.signal,
      onProgress: (snapshot) => snapshots.push(snapshot),
    });

    const req = httpTesting.expectOne('https://storage.example.test/empty');
    req.event({ type: HttpEventType.UploadProgress, loaded: 0, total: 0 });
    req.flush(null, { status: 200, statusText: 'OK' });

    await expect(uploadPromise).resolves.toBeUndefined();
    expect(snapshots).toStrictEqual([{ progress: 100, bytesPerSecond: null }]);
  });

  it('fails fast without retrying when S3 omits the ETag header and aborts sibling parts in the batch', async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4, 5, 6])], 'no-etag.bin', {
      type: 'application/octet-stream',
    });
    const controller = new AbortController();

    const uploadPromise = executor.uploadMultipart({
      file,
      intent: {
        uploadMode: 'multipart',
        uploadId: 'upload-no-etag',
        partSizeBytes: 3,
        partCount: 2,
        finalizeDeadline: '2026-08-10T11:00:00.000Z',
      },
      signal: controller.signal,
      onProgress: () => undefined,
    });

    const presign = await waitForRequest(httpTesting, '/api/uploads/upload-no-etag/parts/presign');
    presign.flush({
      uploadId: 'upload-no-etag',
      parts: [
        {
          partNumber: 1,
          uploadUrl: 'https://storage.example.test/ne1',
          expiresInSeconds: 900,
          requiredHeaders: { 'x-amz-checksum-sha256': 'b64-1' },
        },
        {
          partNumber: 2,
          uploadUrl: 'https://storage.example.test/ne2',
          expiresInSeconds: 900,
          requiredHeaders: { 'x-amz-checksum-sha256': 'b64-2' },
        },
      ],
    });

    const [req1, req2] = await Promise.all([
      waitForRequest(httpTesting, 'https://storage.example.test/ne1'),
      waitForRequest(httpTesting, 'https://storage.example.test/ne2'),
    ]);

    req1.flush(null, { status: 200, statusText: 'OK' });

    await expect(uploadPromise).rejects.toThrow('Missing ETag header for part 1');
    expect(req2.cancelled).toBe(true);
  });

  it('retries transient 429 presignParts errors respecting Retry-After and fails fast on 409', async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4, 5, 6])], 'presign-retry.bin', {
      type: 'application/octet-stream',
    });
    const controller = new AbortController();

    const uploadPromise = executor.uploadMultipart({
      file,
      intent: {
        uploadMode: 'multipart',
        uploadId: 'upload-presign-retry',
        partSizeBytes: 3,
        partCount: 2,
        finalizeDeadline: '2026-08-10T11:00:00.000Z',
      },
      signal: controller.signal,
      onProgress: () => undefined,
    });

    const presign1 = await waitForRequest(
      httpTesting,
      '/api/uploads/upload-presign-retry/parts/presign',
    );
    presign1.flush(
      { code: 'rate_limit_exceeded', message: 'Previše zahtjeva.' },
      { status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '2' } },
    );

    // Let catch block schedule the 2s Retry-After timer before advancing fake time
    await vi.advanceTimersByTimeAsync(0);

    // 1s is not enough when Retry-After is 2s
    await vi.advanceTimersByTimeAsync(1_000);
    expect(httpTesting.match('/api/uploads/upload-presign-retry/parts/presign')).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1_000);
    const presign2 = await waitForRequest(
      httpTesting,
      '/api/uploads/upload-presign-retry/parts/presign',
    );
    presign2.flush({
      uploadId: 'upload-presign-retry',
      parts: [
        {
          partNumber: 1,
          uploadUrl: 'https://storage.example.test/pr1',
          expiresInSeconds: 900,
          requiredHeaders: { 'x-amz-checksum-sha256': 'b64-1' },
        },
        {
          partNumber: 2,
          uploadUrl: 'https://storage.example.test/pr2',
          expiresInSeconds: 900,
          requiredHeaders: { 'x-amz-checksum-sha256': 'b64-2' },
        },
      ],
    });

    const [req1, req2] = await Promise.all([
      waitForRequest(httpTesting, 'https://storage.example.test/pr1'),
      waitForRequest(httpTesting, 'https://storage.example.test/pr2'),
    ]);
    req1.flush(null, { status: 200, statusText: 'OK', headers: { ETag: '"e1"' } });
    req2.flush(null, { status: 200, statusText: 'OK', headers: { ETag: '"e2"' } });

    const parts = await uploadPromise;
    expect(parts.map((part) => part.etag)).toStrictEqual(['"e1"', '"e2"']);

    // Non-retryable 409 upload_expired fails immediately without retrying
    const expiredPromise = executor.uploadMultipart({
      file,
      intent: {
        uploadMode: 'multipart',
        uploadId: 'upload-presign-expired',
        partSizeBytes: 3,
        partCount: 2,
        finalizeDeadline: '2026-08-10T11:00:00.000Z',
      },
      signal: controller.signal,
      onProgress: () => undefined,
    });

    const expiredReq = await waitForRequest(
      httpTesting,
      '/api/uploads/upload-presign-expired/parts/presign',
    );
    expiredReq.flush(
      { code: 'upload_expired', message: 'Vrijeme za dovršavanje prijenosa je isteklo.' },
      { status: 409, statusText: 'Conflict' },
    );

    await expect(expiredPromise).rejects.toMatchObject({ status: 409 });
  });
});

async function waitForRequest(httpTesting: HttpTestingController, url: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const matches = httpTesting.match(url);
    if (matches.length > 0) {
      return matches[0];
    }

    await new Promise<void>((resolve) => {
      realSetTimeout(resolve, 5);
    });
  }

  throw new Error(`Request not yet issued: ${url}`);
}
