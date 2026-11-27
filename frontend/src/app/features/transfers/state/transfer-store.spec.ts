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

  it('aborts an active multipart upload on permanent part upload failure to free S3 parts immediately', async () => {
    const bigFile = createFakeSizedFile('fail-part.bin', SINGLE_PART_MAX_BYTES + 50);
    vi.spyOn(uploadExecutor, 'uploadMultipart').mockRejectedValue(
      new Error('Missing ETag header for part 1'),
    );

    const resultPromise = store.startUpload(bigFile, null);

    const presignReq = await waitForRequest(httpTesting, '/api/uploads/presign');
    presignReq.flush({
      uploadMode: 'multipart',
      uploadId: 'upload-fail-1',
      partSizeBytes: SINGLE_PART_MAX_BYTES,
      partCount: 2,
      finalizeDeadline: '2026-08-10T11:00:00.000Z',
    });

    const abortReq = await waitForRequest(httpTesting, '/api/uploads/upload-fail-1/abort');
    expect(abortReq.request.method).toBe('POST');
    abortReq.flush(null, { status: 204, statusText: 'No Content' });

    const result = await resultPromise;
    expect(result).toStrictEqual({
      ok: false,
      error: {
        status: -1,
        code: 'unexpected_error',
        message: 'Prijenos nije uspio.',
      },
    });
    expect(store.transfers()[0]?.phase).toBe('failed');
  });

  it('surfaces Croatian API error messages during multipart part presigning without redundant /abort on terminal server errors', async () => {
    const bigFile = createFakeSizedFile('expired-mid.bin', SINGLE_PART_MAX_BYTES + 50);

    const resultPromise = store.startUpload(bigFile, null);

    const presignReq = await waitForRequest(httpTesting, '/api/uploads/presign');
    presignReq.flush({
      uploadMode: 'multipart',
      uploadId: 'upload-expired-mid',
      partSizeBytes: SINGLE_PART_MAX_BYTES,
      partCount: 2,
      finalizeDeadline: '2026-08-10T11:00:00.000Z',
    });

    const partPresignReq = await waitForRequest(
      httpTesting,
      '/api/uploads/upload-expired-mid/parts/presign',
    );
    partPresignReq.flush(
      { code: 'upload_expired', message: 'Vrijeme za dovršavanje prijenosa je isteklo.' },
      { status: 409, statusText: 'Conflict' },
    );

    const result = await resultPromise;
    expect(result).toStrictEqual({
      ok: false,
      error: {
        status: 409,
        code: 'upload_expired',
        message: 'Vrijeme za dovršavanje prijenosa je isteklo.',
        requestId: undefined,
      },
    });
    expect(store.transfers()[0]?.phase).toBe('failed');
    expect(httpTesting.match('/api/uploads/upload-expired-mid/abort')).toHaveLength(0);
  });

  it('uploads a folder as one grouped transfer using conflictStrategy=rename', async () => {
    const fileA = new File(['hello'], 'a.txt', { type: 'text/plain' });
    const fileB = new File(['world!'], 'b.txt', { type: 'text/plain' });

    const resultPromise = store.startFolderUpload(
      {
        rootName: 'Photos',
        folderPaths: ['Photos', 'Photos/2026'],
        files: [
          { file: fileA, folderPath: 'Photos', relativePath: 'Photos/a.txt' },
          { file: fileB, folderPath: 'Photos/2026', relativePath: 'Photos/2026/b.txt' },
        ],
      },
      'root-target',
    );

    expect(store.transfers()).toHaveLength(1);
    expect(store.transfers()[0]).toMatchObject({
      kind: 'folder',
      folderName: 'Photos',
      totalFiles: 2,
      totalFolders: 2,
      phase: 'preparing',
    });

    const treeReq = await waitForRequest(httpTesting, '/api/folders/tree');
    expect(treeReq.request.body).toStrictEqual({
      parentId: 'root-target',
      paths: ['Photos/2026'],
    });
    treeReq.flush({
      folders: {
        Photos: 'folder-photos',
        'Photos/2026': 'folder-2026',
      },
    });

    const presignReqs = await waitForRequests(httpTesting, '/api/uploads/presign', 2);
    expect(presignReqs.map((r) => r.request.body)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fileName: 'a.txt',
          parentFolderId: 'folder-photos',
          conflictStrategy: 'rename',
        }),
        expect.objectContaining({
          fileName: 'b.txt',
          parentFolderId: 'folder-2026',
          conflictStrategy: 'rename',
        }),
      ]),
    );

    presignReqs.forEach((req, idx) => {
      req.flush({
        uploadMode: 'single',
        uploadId: `folder-upload-${idx + 1}`,
        uploadUrl: `https://storage.example.test/folder-file-${idx + 1}`,
        expiresInSeconds: 600,
        requiredHeaders: {
          'Content-Type': 'text/plain',
          'x-amz-checksum-sha256': '47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=',
        },
      });
    });

    const put1 = await waitForRequest(httpTesting, 'https://storage.example.test/folder-file-1');
    const put2 = await waitForRequest(httpTesting, 'https://storage.example.test/folder-file-2');
    put1.flush(null, { status: 200, statusText: 'OK' });
    put2.flush(null, { status: 200, statusText: 'OK' });

    const complete1 = await waitForRequest(httpTesting, '/api/uploads/folder-upload-1/complete');
    const complete2 = await waitForRequest(httpTesting, '/api/uploads/folder-upload-2/complete');
    complete1.flush({ ...COMPLETED_FILE, id: 'f-1', name: 'a (1).txt', sizeBytes: 5 });
    complete2.flush({ ...COMPLETED_FILE, id: 'f-2', name: 'b.txt', sizeBytes: 6 });

    await expect(resultPromise).resolves.toStrictEqual({
      ok: true,
      createdFolders: true,
      completedFiles: 2,
      failedFiles: 0,
      cancelled: false,
      error: null,
    });
    expect(store.transfers()).toHaveLength(1);
    expect(store.transfers()[0]).toMatchObject({
      kind: 'folder',
      folderName: 'Photos',
      completedFiles: 2,
      totalFiles: 2,
      failedFiles: 0,
      phase: 'completed',
      progress: 100,
      fileErrors: [],
    });
  });

  it('completes an empty folder upload after ensuring the folder tree', async () => {
    const resultPromise = store.startFolderUpload(
      {
        rootName: 'EmptyDir',
        folderPaths: ['EmptyDir', 'EmptyDir/Sub'],
        files: [],
      },
      null,
    );

    const treeReq = await waitForRequest(httpTesting, '/api/folders/tree');
    treeReq.flush({
      folders: {
        EmptyDir: 'folder-empty',
        'EmptyDir/Sub': 'folder-sub',
      },
    });

    await expect(resultPromise).resolves.toStrictEqual({
      ok: true,
      createdFolders: true,
      completedFiles: 0,
      failedFiles: 0,
      cancelled: false,
      error: null,
    });
    expect(store.transfers()[0]).toMatchObject({
      kind: 'folder',
      folderName: 'EmptyDir',
      totalFiles: 0,
      totalFolders: 2,
      phase: 'completed',
      progress: 100,
    });
  });

  it('fails the folder transfer cleanly when /api/folders/tree returns a conflict', async () => {
    const resultPromise = store.startFolderUpload(
      {
        rootName: 'Blocked',
        folderPaths: ['Blocked'],
        files: [
          {
            file: new File(['x'], 'doc.txt', { type: 'text/plain' }),
            folderPath: 'Blocked',
            relativePath: 'Blocked/doc.txt',
          },
        ],
      },
      null,
    );

    const treeReq = await waitForRequest(httpTesting, '/api/folders/tree');
    treeReq.flush(
      {
        code: 'folder_path_conflict',
        message: 'Na odabranoj putanji već postoji datoteka s istim nazivom.',
      },
      { status: 409, statusText: 'Conflict' },
    );

    const result = await resultPromise;
    expect(result).toMatchObject({
      ok: false,
      createdFolders: false,
      completedFiles: 0,
      failedFiles: 0,
      cancelled: false,
      error: {
        code: 'folder_path_conflict',
        message: 'Na odabranoj putanji već postoji datoteka s istim nazivom.',
      },
    });
    expect(store.failedCount()).toBe(1);
    expect(store.transfers()[0]).toMatchObject({
      kind: 'folder',
      phase: 'failed',
      fileErrors: [],
    });
  });

  it('continues uploading remaining files when one file fails and records per-file errors', async () => {
    const oversizedFile = createFakeSizedFile('too-big.bin', MAX_UPLOAD_SIZE_BYTES + 1);
    const validFile = new File(['ok'], 'ok.txt', { type: 'text/plain' });

    const resultPromise = store.startFolderUpload(
      {
        rootName: 'Mixed',
        folderPaths: ['Mixed'],
        files: [
          { file: oversizedFile, folderPath: 'Mixed', relativePath: 'Mixed/too-big.bin' },
          { file: validFile, folderPath: 'Mixed', relativePath: 'Mixed/ok.txt' },
        ],
      },
      null,
    );

    const treeReq = await waitForRequest(httpTesting, '/api/folders/tree');
    treeReq.flush({ folders: { Mixed: 'folder-mixed' } });

    const presignReq = await waitForRequest(httpTesting, '/api/uploads/presign');
    expect(presignReq.request.body).toMatchObject({ fileName: 'ok.txt' });
    presignReq.flush({
      uploadMode: 'single',
      uploadId: 'mixed-ok-1',
      uploadUrl: 'https://storage.example.test/mixed-ok',
      expiresInSeconds: 600,
      requiredHeaders: {
        'Content-Type': 'text/plain',
        'x-amz-checksum-sha256': '47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=',
      },
    });

    const putReq = await waitForRequest(httpTesting, 'https://storage.example.test/mixed-ok');
    putReq.flush(null, { status: 200, statusText: 'OK' });

    const completeReq = await waitForRequest(httpTesting, '/api/uploads/mixed-ok-1/complete');
    completeReq.flush({ ...COMPLETED_FILE, id: 'f-ok', name: 'ok.txt', sizeBytes: 2 });

    const result = await resultPromise;
    expect(result).toMatchObject({
      ok: false,
      createdFolders: true,
      completedFiles: 1,
      failedFiles: 1,
      cancelled: false,
    });
    expect(store.failedCount()).toBe(1);
    expect(store.transfers()[0]).toMatchObject({
      kind: 'folder',
      phase: 'failed',
      completedFiles: 1,
      failedFiles: 1,
      fileErrors: [
        {
          relativePath: 'Mixed/too-big.bin',
          fileName: 'too-big.bin',
          code: 'file_too_large',
          message: 'Datoteka ne može biti veća od 512 GB.',
        },
      ],
    });
  });

  it('cancels an active folder upload, aborts in-flight uploads, and does not start queued files', async () => {
    const big1 = createFakeSizedFile('one.bin', SINGLE_PART_MAX_BYTES + 10);
    const big2 = createFakeSizedFile('two.bin', SINGLE_PART_MAX_BYTES + 10);
    const big3 = createFakeSizedFile('three.bin', SINGLE_PART_MAX_BYTES + 10);
    const big4 = createFakeSizedFile('four.bin', SINGLE_PART_MAX_BYTES + 10);

    vi.spyOn(uploadExecutor, 'uploadMultipart').mockImplementation(({ signal }) => {
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    });

    const resultPromise = store.startFolderUpload(
      {
        rootName: 'CancelFolder',
        folderPaths: ['CancelFolder'],
        files: [big1, big2, big3, big4].map((file) => ({
          file,
          folderPath: 'CancelFolder',
          relativePath: `CancelFolder/${file.name}`,
        })),
      },
      null,
    );

    const treeReq = await waitForRequest(httpTesting, '/api/folders/tree');
    treeReq.flush({ folders: { CancelFolder: 'folder-cancel' } });

    const presignReqs = await waitForRequests(httpTesting, '/api/uploads/presign', 3);
    presignReqs.forEach((req, idx) => {
      req.flush({
        uploadMode: 'multipart',
        uploadId: `cancel-folder-up-${idx + 1}`,
        partSizeBytes: SINGLE_PART_MAX_BYTES,
        partCount: 2,
        finalizeDeadline: '2026-08-10T11:00:00.000Z',
      });
    });

    await Promise.resolve();
    const transferId = store.transfers()[0]!.id;
    store.cancelTransfer(transferId);

    for (const id of ['cancel-folder-up-1', 'cancel-folder-up-2', 'cancel-folder-up-3']) {
      const abortReq = await waitForRequest(httpTesting, `/api/uploads/${id}/abort`);
      abortReq.flush(null, { status: 204, statusText: 'No Content' });
    }

    const result = await resultPromise;
    expect(result).toMatchObject({
      ok: false,
      createdFolders: true,
      cancelled: true,
    });
    expect(store.transfers()[0]?.phase).toBe('cancelled');
    expect(store.failedCount()).toBe(0);
    // 4th file should never have requested a presign intent
    expect(httpTesting.match('/api/uploads/presign')).toHaveLength(0);

    store.clearFinished();
    expect(store.transfers()).toHaveLength(0);
  });

  it('handles prototype-named folders like __proto__ and constructor safely via Map lookup', async () => {
    const file = new File(['hi'], 'note.txt', { type: 'text/plain' });

    const resultPromise = store.startFolderUpload(
      {
        rootName: '__proto__',
        folderPaths: ['__proto__', '__proto__/constructor'],
        files: [
          {
            file,
            folderPath: '__proto__',
            relativePath: '__proto__/note.txt',
          },
        ],
      },
      null,
    );

    const treeReq = await waitForRequest(httpTesting, '/api/folders/tree');
    expect(treeReq.request.body).toStrictEqual({
      parentId: null,
      paths: ['__proto__/constructor'],
    });
    const rawFolders: Record<string, string> = {};
    Object.defineProperty(rawFolders, '__proto__', {
      value: 'folder-proto-id',
      enumerable: true,
      writable: true,
      configurable: true,
    });
    rawFolders['__proto__/constructor'] = 'folder-ctor-id';
    treeReq.flush({ folders: rawFolders });

    const presignReq = await waitForRequest(httpTesting, '/api/uploads/presign');
    expect(presignReq.request.body).toMatchObject({
      fileName: 'note.txt',
      parentFolderId: 'folder-proto-id',
      conflictStrategy: 'rename',
    });
    presignReq.flush({
      uploadMode: 'single',
      uploadId: 'proto-up-1',
      uploadUrl: 'https://storage.example.test/proto-up-1',
      expiresInSeconds: 600,
      requiredHeaders: {
        'Content-Type': 'text/plain',
        'x-amz-checksum-sha256': '47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=',
      },
    });

    const putReq = await waitForRequest(httpTesting, 'https://storage.example.test/proto-up-1');
    putReq.flush(null, { status: 200, statusText: 'OK' });

    const completeReq = await waitForRequest(httpTesting, '/api/uploads/proto-up-1/complete');
    completeReq.flush({ ...COMPLETED_FILE, id: 'f-proto', name: 'note.txt', sizeBytes: 2 });

    await expect(resultPromise).resolves.toMatchObject({
      ok: true,
      createdFolders: true,
      completedFiles: 1,
      failedFiles: 0,
    });
  });

  it('chunks large folder trees within the 2000-node limit and marks createdFolders=true if an earlier chunk succeeded before failure', async () => {
    // 600 branches of depth 5 -> 1 + 600 * 4 = 2401 unique nodes (> 2000) despite only 600 leaf paths (< 1000)
    const leafPaths = Array.from({ length: 600 }, (_, i) => `Root/b${i}/c/d/e`);

    const resultPromise = store.startFolderUpload(
      {
        rootName: 'Root',
        folderPaths: ['Root', ...leafPaths],
        files: [],
      },
      null,
    );

    const chunk1 = await waitForRequest(httpTesting, '/api/folders/tree');
    const chunk1Paths = (chunk1.request.body as { paths: string[] }).paths;
    expect(chunk1Paths.length).toBe(499);
    chunk1.flush({ folders: { Root: 'root-id' } });

    const chunk2 = await waitForRequest(httpTesting, '/api/folders/tree');
    const chunk2Paths = (chunk2.request.body as { paths: string[] }).paths;
    expect(chunk2Paths.length).toBe(101);
    chunk2.flush(
      {
        code: 'folder_path_conflict',
        message: 'Na odabranoj putanji već postoji datoteka s istim nazivom.',
      },
      { status: 409, statusText: 'Conflict' },
    );

    const result = await resultPromise;
    expect(result).toMatchObject({
      ok: false,
      createdFolders: true,
      error: { code: 'folder_path_conflict' },
    });
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

async function waitForRequests(httpTesting: HttpTestingController, url: string, count: number) {
  return vi.waitFor(() => {
    const matches = httpTesting.match(url);
    if (matches.length < count) {
      throw new Error(`Expected ${count} requests to ${url}, found ${matches.length}`);
    }
    return matches;
  });
}
