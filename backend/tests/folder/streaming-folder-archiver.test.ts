import { PassThrough, Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mock, type MockProxy } from 'vitest-mock-extended';
import { StreamingFolderArchiver } from '../../src/folder/download/streaming-folder-archiver.js';
import type { ObjectStorage } from '../../src/storage/object-storage.js';

describe('StreamingFolderArchiver', () => {
  let storage: MockProxy<ObjectStorage>;
  let archiver: StreamingFolderArchiver;
  let uploadedArchive: Buffer;

  beforeEach(() => {
    storage = mock<ObjectStorage>();
    archiver = new StreamingFolderArchiver(storage);
    uploadedArchive = Buffer.alloc(0);

    storage.getObjectStream.mockImplementation((objectKey) => {
      const content = objectKey === 'objects/report' ? 'report body' : 'nested body';
      return Promise.resolve(Readable.from([Buffer.from(content)]));
    });
    storage.uploadObjectStream.mockImplementation(async ({ body }) => {
      const chunks: Buffer[] = [];
      for await (const chunk of body as AsyncIterable<unknown>) {
        if (typeof chunk !== 'string' && !(chunk instanceof Uint8Array)) {
          throw new Error('ZIP upload emitted an unsupported chunk');
        }

        chunks.push(Buffer.from(chunk));
      }
      uploadedArchive = Buffer.concat(chunks);
    });
  });

  it('streams folders and files into a ZIP upload without buffering input objects', async () => {
    const result = await archiver.create({
      archiveObjectKey: 'folder-downloads/user/download/1.zip',
      entries: [
        { kind: 'folder', pathParts: ['Documents'] },
        {
          kind: 'file',
          pathParts: ['Documents', 'report.txt'],
          objectKey: 'objects/report',
          sizeBytes: 11,
        },
        { kind: 'folder', pathParts: ['Documents', 'Nested'] },
        {
          kind: 'file',
          pathParts: ['Documents', 'Nested', 'notes.txt'],
          objectKey: 'objects/notes',
          sizeBytes: 11,
        },
      ],
    });

    expect(result.sizeBytes).toBe(uploadedArchive.length);
    expect(result.sizeBytes).toBeGreaterThan(0);
    expect(uploadedArchive.subarray(0, 2).toString()).toBe('PK');
    expect(uploadedArchive.includes(Buffer.from('Documents/report.txt'))).toBe(true);
    expect(uploadedArchive.includes(Buffer.from('Documents/Nested/notes.txt'))).toBe(true);
    expect(uploadedArchive.includes(Buffer.from('report body'))).toBe(true);
    expect(uploadedArchive.includes(Buffer.from('nested body'))).toBe(true);
    expect(storage.getObjectStream).toHaveBeenCalledTimes(2);
    expect(storage.uploadObjectStream).toHaveBeenCalledOnce();
    expect(storage.uploadObjectStream.mock.lastCall![0]).toMatchObject({
      objectKey: 'folder-downloads/user/download/1.zip',
      contentType: 'application/zip',
    });
  });

  it('rejects an empty archive manifest before starting an upload', async () => {
    await expect(
      archiver.create({
        archiveObjectKey: 'folder-downloads/user/download/1.zip',
        entries: [],
      }),
    ).rejects.toThrow('Folder archive manifest is empty');

    expect(storage.uploadObjectStream).not.toHaveBeenCalled();
  });

  it.each([
    { pathParts: [] },
    { pathParts: [''] },
    { pathParts: ['Documents', '.'] },
    { pathParts: ['Documents', '..'] },
    { pathParts: ['Documents/report.txt'] },
    { pathParts: ['Documents\\report.txt'] },
    { pathParts: ['Documents', 'report\0.txt'] },
  ])('rejects the invalid archive path $pathParts', async ({ pathParts }) => {
    await expect(
      archiver.create({
        archiveObjectKey: 'folder-downloads/user/download/1.zip',
        entries: [{ kind: 'folder', pathParts }],
      }),
    ).rejects.toThrow('Folder archive entry has an invalid path');

    expect(storage.getObjectStream).not.toHaveBeenCalled();
    expect(storage.uploadObjectStream).not.toHaveBeenCalled();
  });

  it('rejects before starting an upload when the signal is already aborted', async () => {
    const controller = new AbortController();
    const abortReason = new Error('lease lost');
    controller.abort(abortReason);

    await expect(
      archiver.create({
        archiveObjectKey: 'folder-downloads/user/download/1.zip',
        entries: [{ kind: 'folder', pathParts: ['Documents'] }],
        signal: controller.signal,
      }),
    ).rejects.toBe(abortReason);

    expect(storage.getObjectStream).not.toHaveBeenCalled();
    expect(storage.uploadObjectStream).not.toHaveBeenCalled();
  });

  it('destroys the active source stream when the upload fails mid-stream', async () => {
    const activeSource = new PassThrough();
    const destroySpy = vi.spyOn(activeSource, 'destroy');
    let rejectUpload!: (error: Error) => void;

    storage.getObjectStream.mockResolvedValueOnce(activeSource);
    storage.uploadObjectStream.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectUpload = reject;
        }),
    );

    const archivePromise = archiver.create({
      archiveObjectKey: 'folder-downloads/user/download/1.zip',
      entries: [
        {
          kind: 'file',
          pathParts: ['Documents', 'slow.bin'],
          objectKey: 'objects/slow',
          sizeBytes: 100,
        },
      ],
    });

    await vi.waitFor(() => {
      expect(storage.getObjectStream).toHaveBeenCalledOnce();
    });

    const uploadError = new Error('S3 multipart upload failed');
    rejectUpload(uploadError);

    await expect(archivePromise).rejects.toBe(uploadError);
    expect(destroySpy).toHaveBeenCalled();
    expect(activeSource.destroyed).toBe(true);
  });

  it('destroys the active source stream and upload body when aborted mid-stream', async () => {
    const controller = new AbortController();
    const activeSource = new PassThrough();
    const destroySpy = vi.spyOn(activeSource, 'destroy');
    let capturedUploadBody!: Readable;

    storage.getObjectStream.mockResolvedValueOnce(activeSource);
    storage.uploadObjectStream.mockImplementationOnce(({ body, signal }) => {
      capturedUploadBody = body;
      return new Promise<void>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('upload aborted')), {
          once: true,
        });
      });
    });

    const archivePromise = archiver.create({
      archiveObjectKey: 'folder-downloads/user/download/1.zip',
      entries: [
        {
          kind: 'file',
          pathParts: ['Documents', 'stalled.bin'],
          objectKey: 'objects/stalled',
          sizeBytes: 100,
        },
      ],
      signal: controller.signal,
    });

    await vi.waitFor(() => {
      expect(storage.getObjectStream).toHaveBeenCalledWith('objects/stalled', controller.signal);
    });

    const abortReason = new Error('Folder download lease lost');
    controller.abort(abortReason);

    await expect(archivePromise).rejects.toBe(abortReason);
    expect(destroySpy).toHaveBeenCalled();
    expect(activeSource.destroyed).toBe(true);
    expect(capturedUploadBody.destroyed).toBe(true);
  });

  it('cleans up streams when the active source stream emits an error', async () => {
    const activeSource = new PassThrough();
    let capturedUploadBody!: Readable;

    storage.getObjectStream.mockResolvedValueOnce(activeSource);
    storage.uploadObjectStream.mockImplementationOnce(async ({ body }) => {
      capturedUploadBody = body;
      for await (const _chunk of body as AsyncIterable<unknown>) {
        // drain until destroyed
      }
    });

    const archivePromise = archiver.create({
      archiveObjectKey: 'folder-downloads/user/download/1.zip',
      entries: [
        {
          kind: 'file',
          pathParts: ['Documents', 'broken.bin'],
          objectKey: 'objects/broken',
          sizeBytes: 100,
        },
      ],
    });

    await vi.waitFor(() => {
      expect(storage.getObjectStream).toHaveBeenCalledOnce();
    });

    const readError = new Error('S3 socket reset');
    activeSource.destroy(readError);

    await expect(archivePromise).rejects.toBe(readError);
    expect(activeSource.destroyed).toBe(true);
    expect(capturedUploadBody.destroyed).toBe(true);
  });
});
