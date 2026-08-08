import {
  AfterViewInit,
  Component,
  DestroyRef,
  DOCUMENT,
  inject,
  OnInit,
  signal,
  TrackByFunction,
  viewChild,
} from '@angular/core';
import { SharedWithMeStore } from './state/shared-with-me-store';
import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import { SharedWithMeFile } from '../../data-access/sharing/sharing-models';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { Icon } from '../../shared/icon/icon';
import { FileSizePipe } from '../../shared/pipes/file-size-pipe';
import { CdkContextMenuTrigger, CdkMenu, CdkMenuItem, CdkTargetMenuAim } from '@angular/cdk/menu';
import { EntryDownloadService } from '../drive/actions/download/entry-download-service';
import { apiErrorMessage } from '../../shared/api-error';
import { Dialog } from '@angular/cdk/dialog';
import { RenameEntryDialog } from '../drive/rename-entry-dialog/rename-entry-dialog';
import { EntryResponse } from '../../data-access/entries/entry-models';

const LOAD_MORE_THRESHOLD = 10;

@Component({
  selector: 'app-shared-with-me-files',
  imports: [
    ScrollingModule,
    DatePipe,
    Icon,
    FileSizePipe,
    CdkContextMenuTrigger,
    CdkMenu,
    CdkMenuItem,
    CdkTargetMenuAim,
  ],
  templateUrl: './shared-with-me-files.html',
})
export class SharedWithMeFiles implements OnInit, AfterViewInit {
  readonly store = inject(SharedWithMeStore);
  readonly destroyRef = inject(DestroyRef);
  readonly viewport = viewChild(CdkVirtualScrollViewport);
  readonly document = inject(DOCUMENT);
  readonly entryDownloadService = inject(EntryDownloadService);
  readonly dialog = inject(Dialog);

  private readonly _downloadFileIds = signal<ReadonlySet<string>>(new Set());
  private readonly _downloadError = signal<string | null>(null);

  readonly downloadFileIds = this._downloadFileIds.asReadonly();
  readonly downloadError = this._downloadError.asReadonly();
  readonly trackFile: TrackByFunction<SharedWithMeFile> = (_index, file) => file.id;
  readonly contextMenuFile = signal<SharedWithMeFile | null>(null);

  ngOnInit(): void {
    this.store.load();
  }

  ngAfterViewInit(): void {
    const viewport = this.viewport();
    if (!viewport) {
      return;
    }

    viewport.renderedRangeStream.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(({ end }) => {
      const loadedCount = this.store.files().length;

      if (loadedCount > 0 && loadedCount - end <= LOAD_MORE_THRESHOLD) {
        this.store.loadMore();
      }
    });
  }

  retry(): void {
    this.store.retry();
  }

  retryLoadMore(): void {
    this.store.retryLoadMore();
  }

  async download(file: SharedWithMeFile): Promise<void> {
    if (this.isDownloading(file.id)) {
      return;
    }

    this._downloadError.set(null);
    this._downloadFileIds.update((current) => {
      const next = new Set(current);
      next.add(file.id);
      return next;
    });

    try {
      const result = await this.entryDownloadService.prepareDownload(file);
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
      this._downloadFileIds.update((current) => {
        const next = new Set(current);
        next.delete(file.id);
        return next;
      });
    }
  }

  isDownloading(fileId: string): boolean {
    return this._downloadFileIds().has(fileId);
  }

  rename(file: SharedWithMeFile): void {
    const dialogRef = this.dialog.open<EntryResponse>(RenameEntryDialog, {
      data: { entry: file },
      width: 'calc(100vw - 2rem)',
      maxWidth: '28rem',
      autoFocus: 'first-tabbable',
      restoreFocus: true,
    });

    dialogRef.closed.subscribe((updatedEntry) => {
      if (updatedEntry !== undefined) {
        this.store.fileRenamed(updatedEntry);
      }
    });
  }
}
