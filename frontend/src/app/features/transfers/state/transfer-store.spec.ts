import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileEntry } from '../../../data-access/entries/entry-models';
import {
  MAX_UPLOAD_SIZE_BYTES,
  SINGLE_PART_MAX_BYTES,
} from '../../../data-access/uploads/upload-constraints';
import { UploadExecutor } from '../upload-executor';
import { TransferStore } from './transfer-store';

const COMPLETED_FILE: FileEntry = {
  kind: 'file',
  id: 'file-1',
  name: 'empty.txt',
  contentType: 'text/plain',
  sizeBytes: 0,
  updatedAt: '2026-08-08T11:00:00.000Z',
};

describe('TransferStore', () => {
  let store: TransferStore;
  let httpTesting: HttpTestingController;
  let uploadExecutor: UploadExecutor;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    store = TestBed.inject(TransferStore);
    httpTesting = TestBed.inject(HttpTestingController);
    uploadExecutor = TestBed.inject(UploadExecutor);
  });

  afterEach(() => {
    httpTesting.verify();
    TestBed.resetTestingModule();
  });

  it('uploads a 0-byte empty file end-to-end via single-part flow', async () => {
    const emptyFile = new File([], 'empty.txt', { type: 'text/plain' });

    const resultPromise = store.startUpload(emptyFile, null);

    const presignReq = await waitForRequest(httpTesting, '/api/uploads/presign');
    expect(presignReq.request.body).toStrictEqual({
      fileName: 'empty.txt',
      parentFolderId: null,
      contentType: 'text/plain',
      size: 0,
      sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    });
    presignReq.flush({
      uploadMode: 'single',
      uploadId: 'upload-empty-1',
      uploadUrl: 'https://storage.example.test/empty',
      expiresInSeconds: 600,
      requiredHeaders: {
        'Content-Type': 'text/plain',
        'x-amz-checksum-sha256': '47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=',
      },
    });

    const putReq = await waitForRequest(httpTesting, 'https://storage.example.test/empty');
    expect(putReq.request.method).toBe('PUT');
    putReq.flush(null, { status: 200, statusText: 'OK' });

    const completeReq = await waitForRequest(httpTesting, '/api/uploads/upload-empty-1/complete');
    expect(completeReq.request.body).toBeNull();
    completeReq.flush(COMPLETED_FILE);

    await expect(resultPromise).resolves.toStrictEqual({ ok: true, value: COMPLETED_FILE });
    expect(store.transfers()[0]).toMatchObject({
      fileName: 'empty.txt',
      sizeBytes: 0,
      phase: 'completed',
      progress: 100,
    });
  });

  it('uploads a > 16 MiB file via multipart flow without upfront sha256 and forwards completed parts', async () => {
    const bigFile = createFakeSizedFile('video.mp4', SINGLE_PART_MAX_BYTES + 1024, 'video/mp4');
    const completedParts = [
      { partNumber: 1, etag: '"e1"', sha256: 'a'.repeat(64) },
      { partNumber: 2, etag: '"e2"', sha256: 'b'.repeat(64) },
    ];
    const multipartSpy = vi
      .spyOn(uploadExecutor, 'uploadMultipart')
      .mockResolvedValue(completedParts);

    const resultPromise = store.startUpload(bigFile, 'folder-1');

    const presignReq = await waitForRequest(httpTesting, '/api/uploads/presign');
    expect(presignReq.request.body).toStrictEqual({
      fileName: 'video.mp4',
      parentFolderId: 'folder-1',
      contentType: 'video/mp4',
      size: SINGLE_PART_MAX_BYTES + 1024,
    });
    presignReq.flush({
      uploadMode: 'multipart',
      uploadId: 'upload-mp-1',
      partSizeBytes: SINGLE_PART_MAX_BYTES,
      partCount: 2,
      finalizeDeadline: '2026-08-10T11:00:00.000Z',
    });

    const completeReq = await waitForRequest(httpTesting, '/api/uploads/upload-mp-1/complete');
    expect(completeReq.request.body).toStrictEqual({ parts: completedParts });
    const completedVideo: FileEntry = {
      ...COMPLETED_FILE,
      id: 'file-video',
      name: 'video.mp4',
      contentType: 'video/mp4',
      sizeBytes: SINGLE_PART_MAX_BYTES + 1024,
    };
    completeReq.flush(completedVideo);

    await expect(resultPromise).resolves.toStrictEqual({ ok: true, value: completedVideo });
    expect(multipartSpy).toHaveBeenCalledOnce();
    expect(store.transfers()[0]?.phase).toBe('completed');
  });

  it('rejects files larger than 512 GiB locally before contacting the API', async () => {
    const hugeFile = createFakeSizedFile('huge.bin', MAX_UPLOAD_SIZE_BYTES + 1);

    const result = await store.startUpload(hugeFile, null);

    expect(result).toStrictEqual({
      ok: false,
      error: {
        status: -1,
        code: 'file_too_large',
        message: 'Datoteka ne može biti veća od 512 GB.',
      },
    });
    expect(store.failedCount()).toBe(1);
  });

  it('cancels an active multipart upload, calls /abort once, and clears cancelled transfers', async () => {
    const bigFile = createFakeSizedFile('cancel.bin', SINGLE_PART_MAX_BYTES + 50);
    let capturedSignal: AbortSignal | undefined;
    vi.spyOn(uploadExecutor, 'uploadMultipart').mockImplementation(({ signal }) => {
      capturedSignal = signal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    });

    const resultPromise = store.startUpload(bigFile, null);

    const presignReq = await waitForRequest(httpTesting, '/api/uploads/presign');
    presignReq.flush({
      uploadMode: 'multipart',
      uploadId: 'upload-cancel-1',
      partSizeBytes: SINGLE_PART_MAX_BYTES,
      partCount: 2,
      finalizeDeadline: '2026-08-10T11:00:00.000Z',
    });

    await Promise.resolve();
    const transferId = store.transfers()[0]!.id;
    expect(store.transfers()[0]?.phase).toBe('uploading');

    store.cancelTransfer(transferId);

    const abortReq = await waitForRequest(httpTesting, '/api/uploads/upload-cancel-1/abort');
    expect(abortReq.request.method).toBe('POST');
    abortReq.flush(null, { status: 204, statusText: 'No Content' });

    const result = await resultPromise;
    expect(capturedSignal?.aborted).toBe(true);
    expect(result).toStrictEqual({
      ok: false,
      error: {
        status: -1,
        code: 'upload_cancelled',
        message: 'Prijenos je otkazan.',
      },
    });
    expect(store.transfers()[0]?.phase).toBe('cancelled');
    expect(store.failedCount()).toBe(0);

    store.clearFinished();
    expect(store.transfers()).toHaveLength(0);
  });

  it('replaces file content using multipart flow for files larger than 16 MiB', async () => {
    const bigReplacement = createFakeSizedFile(
      'replacement.bin',
      SINGLE_PART_MAX_BYTES + 200,
      'application/octet-stream',
    );
    const completedParts = [
      { partNumber: 1, etag: '"r1"', sha256: 'a'.repeat(64) },
      { partNumber: 2, etag: '"r2"', sha256: 'b'.repeat(64) },
    ];
    vi.spyOn(uploadExecutor, 'uploadMultipart').mockResolvedValue(completedParts);

    const resultPromise = store.startReplacement(bigReplacement, COMPLETED_FILE);

    const replaceReq = await waitForRequest(httpTesting, '/api/files/file-1/replacements');
    expect(replaceReq.request.body).toStrictEqual({
      contentType: 'application/octet-stream',
      size: SINGLE_PART_MAX_BYTES + 200,
    });
    replaceReq.flush({
      uploadMode: 'multipart',
      uploadId: 'upload-rep-mp-1',
      partSizeBytes: SINGLE_PART_MAX_BYTES,
      partCount: 2,
      finalizeDeadline: '2026-08-10T11:00:00.000Z',
    });

    const completeReq = await waitForRequest(httpTesting, '/api/uploads/upload-rep-mp-1/complete');
    expect(completeReq.request.body).toStrictEqual({ parts: completedParts });
    const replacedFile: FileEntry = {
      ...COMPLETED_FILE,
      contentType: 'application/octet-stream',
      sizeBytes: SINGLE_PART_MAX_BYTES + 200,
    };
    completeReq.flush(replacedFile);

    await expect(resultPromise).resolves.toStrictEqual({ ok: true, value: replacedFile });
    expect(store.transfers()[0]).toMatchObject({
      operation: 'replace',
      fileName: COMPLETED_FILE.name,
      phase: 'completed',
    });
  });

  it('cancels a transfer while presign intent request is still in flight', async () => {
    const bigFile = createFakeSizedFile('pending-cancel.bin', SINGLE_PART_MAX_BYTES + 50);

    const resultPromise = store.startUpload(bigFile, null);
    const presignReq = await waitForRequest(httpTesting, '/api/uploads/presign');
    const transferId = store.transfers()[0]!.id;

    store.cancelTransfer(transferId);

    const result = await resultPromise;
    expect(presignReq.cancelled).toBe(true);
    expect(result).toStrictEqual({
      ok: false,
      error: {
        status: -1,
        code: 'upload_cancelled',
        message: 'Prijenos je otkazan.',
      },
    });
    expect(store.transfers()[0]?.phase).toBe('cancelled');
  });
});

function createFakeSizedFile(name: string, size: number, type = 'application/octet-stream'): File {
  const file = new File([], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

async function waitForRequest(httpTesting: HttpTestingController, url: string) {
  return vi.waitFor(() => {
    const matches = httpTesting.match(url);
    if (matches.length === 0) {
      throw new Error(`Request not yet issued: ${url}`);
    }
    return matches[0];
  });
}
