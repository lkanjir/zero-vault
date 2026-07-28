import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it } from 'vitest';
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
  });
});
