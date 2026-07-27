import {
  AfterViewInit,
  Component,
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
import { ActivatedRoute, RouterLink } from '@angular/router';
import { distinctUntilChanged, map } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { apiErrorMessage } from '../../shared/api-error';
import { Dialog } from '@angular/cdk/dialog';
import { RenameEntryDialog } from './rename-entry-dialog/rename-entry-dialog';
import {
  type EntryResponse,
  type FileEntry,
  type FolderEntry,
} from '../../data-access/entries/entry-models';
import { EntryDownloadService } from './actions/download/entry-download-service';
import { CdkTableModule } from '@angular/cdk/table';
import { DatePipe } from '@angular/common';
import { FileSizePipe } from '../../shared/pipes/file-size-pipe';
import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import { MoveEntryDialog } from './move-entry-dialog/move-entry-dialog';
import { DeleteEntryDialog } from './delete-entry-dialog/delete-entry-dialog';

const LOAD_MORE_THRESHOLD = 10;

@Component({
  selector: 'app-drive',
  imports: [
    CdkMenu,
    CdkMenuItem,
    CdkContextMenuTrigger,
    Icon,
    RouterLink,
    CdkTableModule,
    DatePipe,
    FileSizePipe,
    ScrollingModule,
  ],
  templateUrl: './drive.html',
})
export class Drive implements OnInit, AfterViewInit {
  readonly store = inject(DriveStore);
  readonly entryDownloadService = inject(EntryDownloadService);

  readonly route = inject(ActivatedRoute);
  readonly destroyRef = inject(DestroyRef);
  readonly document = inject(DOCUMENT);
  readonly dialog = inject(Dialog);

  private readonly _downloadEntryIds = signal<ReadonlySet<string>>(new Set());
  private readonly _downloadError = signal<string | null>(null);

  readonly downloadEntryIds = this._downloadEntryIds.asReadonly();
  readonly downloadError = this._downloadError.asReadonly();
  readonly displayedColumns = ['name', 'size', 'updatedAt'];

  readonly trackEntry: TrackByFunction<EntryResponse> = (_index, entry) => entry.id;
  readonly viewport = viewChild(CdkVirtualScrollViewport);

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
      const result = await this.entryDownloadService.prepareDownload(selectedEntry);
      if (!result.ok) {
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

  rename(selectedEntry: FolderEntry | FileEntry) {
    this.dialog.open(RenameEntryDialog, {
      data: {
        entry: selectedEntry,
      },
      width: 'calc(100vw - 2rem)',
      maxWidth: '28rem',
      autoFocus: 'first-tabbable',
      restoreFocus: true,
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
}
