import { describe, expect, it } from 'vitest';
import {
  DropFileSystemDirectoryEntry,
  DropFileSystemEntry,
  DropFileSystemFileEntry,
  extractDropItems,
  scanDirectoryInputFiles,
  scanDroppedEntries,
} from './folder-upload-scanner';

describe('folder-upload-scanner', () => {
  it('scans webkitdirectory files, derives all ancestor folder paths, and sorts shallowest-first', () => {
    const f1 = makeRelativeFile('a.txt', 'Photos/2026/Summer/a.txt');
    const f2 = makeRelativeFile('b.txt', 'Photos/2026/b.txt');
    const f3 = makeRelativeFile('notes.md', ' Photos / 2026 / Winter / notes.md ');

    const batches = scanDirectoryInputFiles([f1, f2, f3]);

    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({
      rootName: 'Photos',
      folderPaths: ['Photos', 'Photos/2026', 'Photos/2026/Summer', 'Photos/2026/Winter'],
    });
    expect(batches[0].files.map((item) => item.relativePath)).toStrictEqual([
      'Photos/2026/Summer/a.txt',
      'Photos/2026/b.txt',
      'Photos/2026/Winter/notes.md',
    ]);
    expect(batches[0].files.map((item) => item.folderPath)).toStrictEqual([
      'Photos/2026/Summer',
      'Photos/2026',
      'Photos/2026/Winter',
    ]);
  });

  it('ignores files without a valid folder webkitRelativePath', () => {
    const bareFile = new File(['x'], 'orphan.txt');
    const topOnly = makeRelativeFile('orphan.txt', 'orphan.txt');

    expect(scanDirectoryInputFiles([bareFile, topOnly])).toStrictEqual([]);
  });

  it('loops readEntries() until empty, preserves empty folders, and handles mixed drops', async () => {
    const looseFile = new File(['loose'], 'readme.txt', { type: 'text/plain' });
    const nestedFile1 = new File(['1'], 'one.txt');
    const nestedFile2 = new File(['2'], 'two.txt');
    const nestedFile3 = new File(['3'], 'three.txt');

    const emptyChildDir = makeDirectoryEntry('EmptySub', [[]]);
    const bigDir = makeDirectoryEntry('Project', [
      // Simulate browser paging readEntries() across multiple chunks
      [makeFileEntry(nestedFile1), emptyChildDir],
      [makeFileEntry(nestedFile2), makeFileEntry(nestedFile3)],
      [],
    ]);
    const emptyRootDir = makeDirectoryEntry('EmptyRoot', [[]]);

    const scanned = await scanDroppedEntries({
      entries: [makeFileEntry(looseFile), bigDir, emptyRootDir],
      fallbackFiles: [],
    });

    expect(scanned.looseFiles).toStrictEqual([looseFile]);
    expect(scanned.folders).toHaveLength(2);
    expect(scanned.folders[0]).toMatchObject({
      rootName: 'Project',
      folderPaths: ['Project', 'Project/EmptySub'],
    });
    expect(scanned.folders[0].files.map((item) => item.relativePath)).toStrictEqual([
      'Project/one.txt',
      'Project/two.txt',
      'Project/three.txt',
    ]);
    expect(scanned.folders[1]).toStrictEqual({
      rootName: 'EmptyRoot',
      folderPaths: ['EmptyRoot'],
      files: [],
    });
  });

  it('extracts webkitGetAsEntry entries synchronously and falls back to files when unavailable', () => {
    const fallbackFile = new File(['data'], 'fallback.txt');
    const dirEntry = makeDirectoryEntry('Docs', [[]]);

    const mockDataTransfer = {
      items: [
        {
          kind: 'string',
          webkitGetAsEntry: () => null,
          getAsFile: () => null,
        },
        {
          kind: 'file',
          webkitGetAsEntry: () => dirEntry,
          getAsFile: () => null,
        },
        {
          kind: 'file',
          getAsFile: () => fallbackFile,
        },
      ],
      files: [],
    } as unknown as DataTransfer;

    const extracted = extractDropItems(mockDataTransfer);
    expect(extracted.entries).toStrictEqual([dirEntry]);
    expect(extracted.fallbackFiles).toStrictEqual([fallbackFile]);
  });

  it('falls back to dataTransfer.files when items list is absent', () => {
    const file = new File(['abc'], 'plain.txt');
    const mockDataTransfer = {
      items: undefined,
      files: [file],
    } as unknown as DataTransfer;

    expect(extractDropItems(mockDataTransfer)).toStrictEqual({
      entries: [],
      fallbackFiles: [file],
    });
    expect(extractDropItems(null)).toStrictEqual({
      entries: [],
      fallbackFiles: [],
    });
  });
});

function makeRelativeFile(name: string, relativePath: string): File {
  const file = new File(['content'], name, { type: 'text/plain' });
  Object.defineProperty(file, 'webkitRelativePath', { value: relativePath });
  return file;
}

function makeFileEntry(file: File): DropFileSystemFileEntry {
  return {
    isFile: true,
    isDirectory: false,
    name: file.name,
    file: (success) => success(file),
  };
}

function makeDirectoryEntry(
  name: string,
  chunks: readonly (readonly DropFileSystemEntry[])[],
): DropFileSystemDirectoryEntry {
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => {
      let chunkIndex = 0;
      return {
        readEntries: (success) => {
          const next = chunks[chunkIndex] ?? [];
          chunkIndex += 1;
          success(next);
        },
      };
    },
  };
}
