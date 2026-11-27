import {
  afterRenderEffect,
  AfterViewInit,
  Component,
  computed,
  DestroyRef,
  DOCUMENT,
  inject,
  OnInit,
  signal,
  viewChild,
  type TrackByFunction,
} from '@angular/core';
import { CdkContextMenuTrigger, CdkMenu, CdkMenuItem } from '@angular/cdk/menu';
import { Icon } from '../../shared/icon/icon';
import { DriveStore } from './state/drive-store';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { distinctUntilChanged, map } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { apiErrorMessage } from '../../shared/api-error';
import { Dialog } from '@angular/cdk/dialog';
import { RenameEntryDialog } from './rename-entry-dialog/rename-entry-dialog';
import {
  EntryListItem,
  type FileEntry,
  type FolderEntry,
} from '../../data-access/entries/entry-models';
import { EntryDownloadService } from './actions/download/entry-download-service';
import { DatePipe } from '@angular/common';
import { FileSizePipe } from '../../shared/pipes/file-size-pipe';
import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import { MoveEntryDialog } from './move-entry-dialog/move-entry-dialog';
import { DeleteEntryDialog } from './delete-entry-dialog/delete-entry-dialog';
import { ShareFileDialog } from '../shared-files/share-file-dialog/share-file-dialog';
import { TransferStore } from '../transfers/state/transfer-store';
import {
  extractDropItems,
  ExtractedDropItems,
  scanDroppedEntries,
} from '../transfers/folder-upload-scanner';
import { ReplaceContentDialog } from '../transfers/replace-content-dialog/replace-content-dialog';
import { FolderBreadcrumbs } from './folder-breadcrumbs/folder-breadcrumbs';

const LOAD_MORE_THRESHOLD = 10;

@Component({
  selector: 'app-drive',
  imports: [
    CdkMenu,
    CdkMenuItem,
    CdkContextMenuTrigger,
    Icon,
    RouterLink,
    DatePipe,
    FileSizePipe,
    ScrollingModule,
    FolderBreadcrumbs,
  ],
  templateUrl: './drive.html',
  host: {
    class: 'relative block h-full min-h-0 w-full',
    '(dragenter)': 'onDragEnter($event)',
    '(dragover)': 'onDragOver($event)',
    '(dragleave)': 'onDragLeave($event)',
    '(drop)': 'onDrop($event)',
  },
})
export class Drive implements OnInit, AfterViewInit {
  readonly store = inject(DriveStore);
  readonly entryDownloadService = inject(EntryDownloadService);
  readonly transferStore = inject(TransferStore);

  readonly route = inject(ActivatedRoute);
  readonly destroyRef = inject(DestroyRef);
  readonly document = inject(DOCUMENT);
  readonly dialog = inject(Dialog);

  private readonly router = inject(Router);
  private readonly downloadAbortController = new AbortController();
  private readonly _downloadEntryIds = signal<ReadonlySet<string>>(new Set());
  private readonly _downloadError = signal<string | null>(null);
  private readonly _isDragOver = signal(false);
  private readonly _dropError = signal<string | null>(null);
  private dragDepth = 0;

  readonly downloadEntryIds = this._downloadEntryIds.asReadonly();
  readonly downloadError = this._downloadError.asReadonly();
  readonly isDragOver = this._isDragOver.asReadonly();
  readonly dropError = this._dropError.asReadonly();

  readonly trackEntry: TrackByFunction<EntryListItem> = (_index, entry) => entry.id;
  readonly viewport = viewChild(CdkVirtualScrollViewport);
  readonly contextMenuEntry = signal<EntryListItem | null>(null);

  readonly emptyMessage = computed(() => {
    const search = this.store.search();
    const kind = this.store.kind();

    if (search !== null) {
      return `Nema rezultata za "${search}".`;
    }

    if (kind === 'file') {
      return `U ovom direktoriju nema datoteka.`;
    }

    if (kind === 'folder') {
      return 'U ovom direktoriju nema poddirektorija.';
    }

    return 'Ovaj direktorij je prazan.';
  });

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.downloadAbortController.abort();
      this.store.reset();
    });

    afterRenderEffect({
      write: () => {
        this.store.search();
        this.store.kind();
        this.store.sort();

        this.viewport()?.scrollToIndex(0);
      },
    });
  }

  ngOnInit(): void {
    this.route.paramMap
      .pipe(
        map((params) => params.get('folderId')),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((folderId) => {
        this.viewport()?.scrollToIndex(0);
        this.store.loadFolder(folderId);
      });
  }

  ngAfterViewInit(): void {
    const viewport = this.viewport();

    if (!viewport) {
      return;
    }

    viewport.renderedRangeStream.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(({ end }) => {
      const loadedCount = this.store.entries().length;

      if (loadedCount === 0) {
        return;
      }

      const remainingCount = loadedCount - end;

      if (remainingCount <= LOAD_MORE_THRESHOLD) {
        this.store.loadMore();
      }
    });
  }

  retry(): void {
    this.store.reload();
  }

  retryLoadMore(): void {
    this.store.loadMore();
  }

  async download(selectedEntry: FolderEntry | FileEntry): Promise<void> {
    if (this.isDownloading(selectedEntry.id)) {
      return;
    }

    this._downloadError.set(null);
    this._downloadEntryIds.update((current) => {
      const next = new Set(current);
      next.add(selectedEntry.id);
      return next;
    });

    try {
      const result = await this.entryDownloadService.prepareDownload(selectedEntry, {
        signal: this.downloadAbortController.signal,
      });
      if (!result.ok) {
        if (result.error.code === 'download_cancelled') {
          return;
        }

        this._downloadError.set(apiErrorMessage(result.error, 'Preuzimanje nije uspjelo.'));
        return;
      }

      const link = this.document.createElement('a');
      link.href = result.value;
      link.style.display = 'none';

      this.document.body.append(link);
      link.click();
      link.remove();
    } catch {
      this._downloadError.set('Preuzimanje nije uspjelo.');
    } finally {
      this._downloadEntryIds.update((current) => {
        const next = new Set(current);
        next.delete(selectedEntry.id);
        return next;
      });
    }
  }

  isDownloading(entryId: string): boolean {
    return this._downloadEntryIds().has(entryId);
  }

  rename(selectedEntry: FolderEntry | FileEntry): void {
    const sourceParentId = this.store.parentId();

    const dialogRef = this.dialog.open<EntryListItem>(RenameEntryDialog, {
      data: {
        entry: selectedEntry,
      },
      width: 'calc(100vw - 2rem)',
      maxWidth: '28rem',
      autoFocus: 'first-tabbable',
      restoreFocus: true,
    });

    dialogRef.closed.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((updatedEntry) => {
      if (updatedEntry !== undefined) {
        this.store.reloadIfCurrent(sourceParentId);
      }
    });
  }

  move(selectedEntry: FolderEntry | FileEntry): void {
    const sourceParentId = this.store.parentId();
    this.dialog.open(MoveEntryDialog, {
      data: {
        entry: selectedEntry,
        sourceParentId,
      },
      width: 'calc(100vw - 2rem)',
      maxWidth: '36rem',
      autoFocus: 'first-tabbable',
      restoreFocus: true,
    });
  }

  delete(selectedEntry: FolderEntry | FileEntry): void {
    this.dialog.open(DeleteEntryDialog, {
      data: { entry: selectedEntry },
      width: 'calc(100vw - 2rem)',
      maxWidth: '28rem',
      autoFocus: 'first-tabbable',
      restoreFocus: true,
    });
  }

  share(selectedFile: FileEntry): void {
    this.dialog.open(ShareFileDialog, {
      data: { file: selectedFile },
      width: 'calc(100vw - 2rem)',
      maxWidth: '28rem',
      autoFocus: 'first-tabbable',
      restoreFocus: true,
    });
  }

  sortByName(): void {
    const nextSort = this.store.sort() === 'name-asc' ? 'name-desc' : 'name-asc';
    this.store.setSort(nextSort);
  }

  sortByUpdatedAt(): void {
    const nextSort = this.store.sort() === 'updated-desc' ? 'updated-asc' : 'updated-desc';
    this.store.setSort(nextSort);
  }

  replaceContent(targetFile: FileEntry): void {
    const parentId = this.store.parentId();
    const dialogRef = this.dialog.open<File>(ReplaceContentDialog, {
      data: { targetFile },
      width: 'calc(100vw - 2rem)',
      maxWidth: '28rem',
      autoFocus: 'first-tabbable',
      restoreFocus: true,
    });

    dialogRef.closed.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((replacementFile) => {
      if (replacementFile === undefined) {
        return;
      }

      void this.startReplacement(replacementFile, targetFile, parentId);
    });
  }

  private async startReplacement(
    replacementFile: File,
    targetFile: FileEntry,
    parentId: string | null,
  ): Promise<void> {
    const result = await this.transferStore.startReplacement(replacementFile, targetFile);

    if (result.ok) {
      this.store.reloadIfCurrent(parentId);
    }
  }

  navigateToFolder(folderId: string | null): void {
    const commands = folderId === null ? ['/drive'] : ['/drive', folderId];

    this.router.navigate(commands);
  }

  onDragEnter(event: DragEvent): void {
    if (!this.hasDraggedFiles(event)) {
      return;
    }

    event.preventDefault();
    this.dragDepth += 1;
    this._isDragOver.set(true);
  }

  onDragOver(event: DragEvent): void {
    if (!this.hasDraggedFiles(event)) {
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
  }

  onDragLeave(event: DragEvent): void {
    if (!this._isDragOver()) {
      return;
    }

    event.preventDefault();
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (this.dragDepth === 0) {
      this._isDragOver.set(false);
    }
  }

  onDrop(event: DragEvent): void {
    if (!this.hasDraggedFiles(event) && !this._isDragOver()) {
      return;
    }

    event.preventDefault();
    this.dragDepth = 0;
    this._isDragOver.set(false);
    this._dropError.set(null);

    const extracted = extractDropItems(event.dataTransfer);
    if (extracted.entries.length === 0 && extracted.fallbackFiles.length === 0) {
      return;
    }

    const targetParentId = this.store.parentId();
    void this.processDroppedItems(extracted, targetParentId);
  }

  private async processDroppedItems(
    extracted: ExtractedDropItems,
    targetParentId: string | null,
  ): Promise<void> {
    try {
      const { folders, looseFiles } = await scanDroppedEntries(extracted);
      if (folders.length === 0 && looseFiles.length === 0) {
        return;
      }

      const tasks: Promise<boolean>[] = [];

      for (const batch of folders) {
        tasks.push(
          this.transferStore
            .startFolderUpload(batch, targetParentId)
            .then((result) => result.createdFolders || result.completedFiles > 0),
        );
      }

      if (looseFiles.length > 0) {
        tasks.push(
          this.transferStore
            .startUploads(looseFiles, targetParentId)
            .then((results) => results.some((result) => result.ok)),
        );
      }

      const outcomes = await Promise.all(tasks);
      if (outcomes.some(Boolean)) {
        this.store.reloadIfCurrent(targetParentId);
      }
    } catch {
      this._dropError.set('Učitavanje ispuštenih datoteka ili mapa nije uspjelo.');
    }
  }

  private hasDraggedFiles(event: DragEvent): boolean {
    const types = event.dataTransfer?.types;
    return types !== undefined && Array.from(types).includes('Files');
  }
}
