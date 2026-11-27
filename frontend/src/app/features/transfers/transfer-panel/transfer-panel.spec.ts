import { TestBed } from '@angular/core/testing';
import {
  LucideChevronDown,
  LucideFileText,
  LucideFolder,
  LucideTrash2,
  LucideX,
  provideLucideIcons,
} from '@lucide/angular';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FolderUploadTransfer, UploadTransfer } from '../state/transfer-models';
import { TransferPanel } from './transfer-panel';

describe('TransferPanel', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TransferPanel],
      providers: [
        provideLucideIcons(LucideChevronDown, LucideFileText, LucideFolder, LucideTrash2, LucideX),
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders a grouped folder transfer item with aggregate progress, cancel action, and collapsible per-file errors', () => {
    const fixture = TestBed.createComponent(TransferPanel);
    const activeFolder: FolderUploadTransfer = {
      kind: 'folder',
      id: 'folder-transfer-1',
      folderName: 'Vacation',
      totalSizeBytes: 2048,
      uploadedBytes: 1024,
      totalFiles: 4,
      completedFiles: 2,
      failedFiles: 1,
      totalFolders: 3,
      phase: 'uploading',
      progress: 50,
      bytesPerSecond: 512,
      error: null,
      fileErrors: [
        {
          relativePath: 'Vacation/raw/bad.bin',
          fileName: 'bad.bin',
          code: 'file_too_large',
          message: 'Datoteka ne može biti veća od 512 GB.',
        },
      ],
    };

    const transfers: UploadTransfer[] = [activeFolder];
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('transfers', transfers);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Vacation');
    expect(text).toContain('2/4 datoteka');
    expect(text).toContain('50%');
    expect(text).toContain('Prikaži greške (1)');
    expect(text).not.toContain('Vacation/raw/bad.bin');

    const cancelSpy = vi.fn();
    fixture.componentInstance.cancelRequested.subscribe(cancelSpy);

    const cancelButton = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      'button[aria-label="Otkaži prijenos direktorija"]',
    );
    expect(cancelButton).not.toBeNull();
    cancelButton!.click();
    expect(cancelSpy).toHaveBeenCalledExactlyOnceWith('folder-transfer-1');

    const expandButton = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      'button[aria-expanded="false"]',
    );
    expect(expandButton).not.toBeNull();
    expandButton!.click();
    fixture.detectChanges();

    const expandedText = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(expandedText).toContain('Direktoriji: 3');
    expect(expandedText).toContain('Vacation/raw/bad.bin');
    expect(expandedText).toContain('Datoteka ne može biti veća od 512 GB.');
  });
});
