import { Dialog } from '@angular/cdk/dialog';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  LucideArrowUpDown,
  LucideChevronDown,
  LucideCloud,
  LucideFileText,
  LucideFolder,
  LucideFolderOpen,
  LucideGalleryVerticalEnd,
  LucideLogOut,
  LucidePanelLeft,
  LucidePanelLeftClose,
  LucidePlus,
  LucideSearch,
  LucideShare2,
  LucideTrash2,
  LucideUser,
  LucideX,
  provideLucideIcons,
} from '@lucide/angular';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../auth/auth-service';
import { DriveStore } from '../../features/drive/state/drive-store';
import { TransferStore } from '../../features/transfers/state/transfer-store';
import { AppShell } from './app-shell';

describe('AppShell folder upload selection', () => {
  const parentId = signal<string | null>('folder-root-1');
  let driveStoreMock: Partial<DriveStore>;
  let transferStoreMock: Partial<TransferStore>;

  beforeEach(() => {
    parentId.set('folder-root-1');
    driveStoreMock = {
      parentId: parentId.asReadonly(),
      search: signal<string | null>(null).asReadonly(),
      kind: signal<null>(null).asReadonly(),
      reloadIfCurrent: vi.fn(),
      setSearch: vi.fn(),
      setKind: vi.fn(),
    };
    transferStoreMock = {
      transfers: signal([]).asReadonly(),
      failedCount: signal(0).asReadonly(),
      panelOpen: signal(false).asReadonly(),
      startUploads: vi.fn().mockResolvedValue([]),
      startFolderUpload: vi.fn().mockResolvedValue({
        ok: true,
        createdFolders: true,
        completedFiles: 2,
        failedFiles: 0,
        cancelled: false,
        error: null,
      }),
      togglePanel: vi.fn(),
      closePanel: vi.fn(),
      clearFinished: vi.fn(),
      cancelTransfer: vi.fn(),
    };

    TestBed.configureTestingModule({
      imports: [AppShell],
      providers: [
        provideRouter([]),
        provideLucideIcons(
          LucideArrowUpDown,
          LucideChevronDown,
          LucideCloud,
          LucideFileText,
          LucideFolder,
          LucideFolderOpen,
          LucideGalleryVerticalEnd,
          LucideLogOut,
          LucidePanelLeft,
          LucidePanelLeftClose,
          LucidePlus,
          LucideSearch,
          LucideShare2,
          LucideTrash2,
          LucideUser,
          LucideX,
        ),
        { provide: DriveStore, useValue: driveStoreMock },
        { provide: TransferStore, useValue: transferStoreMock },
        { provide: Dialog, useValue: { open: vi.fn() } },
        {
          provide: AuthService,
          useValue: {
            userProfile: signal(null).asReadonly(),
            accountUrl: signal('').asReadonly(),
            logout: vi.fn(),
          },
        },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('scans selected webkitdirectory files, starts folder upload, resets input, and reloads DriveStore', async () => {
    const fixture = TestBed.createComponent(AppShell);
    fixture.detectChanges();

    const file1 = new File(['one'], 'one.txt', { type: 'text/plain' });
    Object.defineProperty(file1, 'webkitRelativePath', { value: 'Work/one.txt' });
    const file2 = new File(['two'], 'two.txt', { type: 'text/plain' });
    Object.defineProperty(file2, 'webkitRelativePath', { value: 'Work/Reports/two.txt' });

    const mockInput = {
      files: [file1, file2],
      value: 'C:\\fakepath\\Work',
    };

    await fixture.componentInstance.onFolderChanged({
      target: mockInput,
    } as unknown as Event);

    expect(mockInput.value).toBe('');
    expect(transferStoreMock.startFolderUpload).toHaveBeenCalledExactlyOnceWith(
      {
        rootName: 'Work',
        folderPaths: ['Work', 'Work/Reports'],
        files: [
          { file: file1, folderPath: 'Work', relativePath: 'Work/one.txt' },
          { file: file2, folderPath: 'Work/Reports', relativePath: 'Work/Reports/two.txt' },
        ],
      },
      'folder-root-1',
    );
    expect(driveStoreMock.reloadIfCurrent).toHaveBeenCalledExactlyOnceWith('folder-root-1');
  });
});
