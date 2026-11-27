import { Dialog } from '@angular/cdk/dialog';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import {
  LucideArrowUpDown,
  LucideChevronDown,
  LucideChevronRight,
  LucideCloud,
  LucideDownload,
  LucideFileText,
  LucideFolder,
  LucideFolderOpen,
  LucideMove,
  LucideShare2,
  LucideSquarePen,
  LucideTrash2,
  provideLucideIcons,
} from '@lucide/angular';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EntryDownloadService } from './actions/download/entry-download-service';
import { Drive } from './drive';
import { DriveStore } from './state/drive-store';
import { TransferStore } from '../transfers/state/transfer-store';
import {
  DropFileSystemDirectoryEntry,
  DropFileSystemEntry,
  DropFileSystemFileEntry,
} from '../transfers/folder-upload-scanner';

describe('Drive drag-and-drop', () => {
  const parentId = signal<string | null>('folder-current');
  let driveStoreMock: Partial<DriveStore>;
  let transferStoreMock: {
    startFolderUpload: ReturnType<typeof vi.fn>;
    startUploads: ReturnType<typeof vi.fn>;
    startReplacement: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    parentId.set('folder-current');
    driveStoreMock = {
      parentId: parentId.asReadonly(),
      path: signal([]).asReadonly(),
      entries: signal([]).asReadonly(),
      loading: signal(false).asReadonly(),
      error: signal<string | null>(null).asReadonly(),
      loadingMore: signal(false).asReadonly(),
      loadMoreError: signal<string | null>(null).asReadonly(),
      search: signal<string | null>(null).asReadonly(),
      kind: signal<null>(null).asReadonly(),
      sort: signal<'name-asc'>('name-asc').asReadonly(),
      loadFolder: vi.fn(),
      loadMore: vi.fn(),
      reload: vi.fn(),
      reloadIfCurrent: vi.fn(),
      reset: vi.fn(),
      setSort: vi.fn(),
    };

    transferStoreMock = {
      startFolderUpload: vi.fn().mockResolvedValue({
        ok: true,
        createdFolders: true,
        completedFiles: 1,
        failedFiles: 0,
        cancelled: false,
        error: null,
      }),
      startUploads: vi.fn().mockResolvedValue([{ ok: true, value: { id: 'file-1' } }]),
      startReplacement: vi.fn(),
    };

    TestBed.configureTestingModule({
      imports: [Drive],
      providers: [
        provideRouter([]),
        provideLucideIcons(
          LucideArrowUpDown,
          LucideChevronDown,
          LucideChevronRight,
          LucideCloud,
          LucideDownload,
          LucideFileText,
          LucideFolder,
          LucideFolderOpen,
          LucideMove,
          LucideShare2,
          LucideSquarePen,
          LucideTrash2,
        ),
        { provide: DriveStore, useValue: driveStoreMock },
        { provide: TransferStore, useValue: transferStoreMock },
        { provide: EntryDownloadService, useValue: { prepareDownload: vi.fn() } },
        { provide: Dialog, useValue: { open: vi.fn() } },
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(convertToParamMap({ folderId: 'folder-current' })) },
        },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('tracks nested dragenter/dragleave without flickering and ignores non-file drags', () => {
    const fixture = TestBed.createComponent(Drive);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    const textDrag = createDragEvent(['text/plain']);
    component.onDragEnter(textDrag);
    expect(component.isDragOver()).toBe(false);

    const fileDrag1 = createDragEvent(['Files']);
    component.onDragEnter(fileDrag1);
    expect(component.isDragOver()).toBe(true);

    // Entering a child element increments depth; leaving it keeps overlay active
    component.onDragEnter(createDragEvent(['Files']));
    component.onDragLeave(createDragEvent(['Files']));
    expect(component.isDragOver()).toBe(true);

    component.onDragLeave(createDragEvent(['Files']));
    expect(component.isDragOver()).toBe(false);
  });

  it('handles mixed folder and loose file drops and reloads DriveStore once completed', async () => {
    const fixture = TestBed.createComponent(Drive);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    const looseFile = new File(['hello'], 'loose.txt', { type: 'text/plain' });
    const nestedFile = new File(['inside'], 'inside.txt', { type: 'text/plain' });

    const dirEntry: DropFileSystemDirectoryEntry = {
      isFile: false,
      isDirectory: true,
      name: 'DroppedFolder',
      createReader: () => {
        let read = false;
        return {
          readEntries: (success) => {
            if (read) {
              success([]);
              return;
            }
            read = true;
            success([
              makeFileEntry(nestedFile),
              {
                isFile: false,
                isDirectory: true,
                name: 'EmptyNested',
                createReader: () => ({ readEntries: (cb) => cb([]) }),
              } as DropFileSystemDirectoryEntry,
            ]);
          },
        };
      },
    };

    const dropEvent = createDragEvent(['Files'], [makeFileEntry(looseFile), dirEntry]);
    component.onDragEnter(createDragEvent(['Files']));
    component.onDrop(dropEvent);

    expect(component.isDragOver()).toBe(false);

    await vi.waitFor(() => {
      expect(driveStoreMock.reloadIfCurrent).toHaveBeenCalledExactlyOnceWith('folder-current');
    });

    expect(transferStoreMock.startFolderUpload).toHaveBeenCalledExactlyOnceWith(
      {
        rootName: 'DroppedFolder',
        folderPaths: ['DroppedFolder', 'DroppedFolder/EmptyNested'],
        files: [
          {
            file: nestedFile,
            folderPath: 'DroppedFolder',
            relativePath: 'DroppedFolder/inside.txt',
          },
        ],
      },
      'folder-current',
    );
    expect(transferStoreMock.startUploads).toHaveBeenCalledExactlyOnceWith(
      [looseFile],
      'folder-current',
    );
  });
});

function makeFileEntry(file: File): DropFileSystemFileEntry {
  return {
    isFile: true,
    isDirectory: false,
    name: file.name,
    file: (success) => success(file),
  };
}

function createDragEvent(
  types: readonly string[],
  entries: readonly DropFileSystemEntry[] = [],
): DragEvent {
  return {
    preventDefault: vi.fn(),
    dataTransfer: {
      types,
      dropEffect: 'none',
      items: entries.map((entry) => ({
        kind: 'file',
        webkitGetAsEntry: () => entry,
        getAsFile: () => null,
      })),
      files: [],
    },
  } as unknown as DragEvent;
}
