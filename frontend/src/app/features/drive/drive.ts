import { Component, DestroyRef, DOCUMENT, inject, OnInit, signal } from '@angular/core';
import { EntryItem } from './entry-item/entry-item';
import { CdkContextMenuTrigger, CdkMenu, CdkMenuItem } from '@angular/cdk/menu';
import { Icon } from '../../shared/icon/icon';
import { DriveStore } from './drive-store';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { distinctUntilChanged, map } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { apiErrorMessage } from '../../shared/api-error';
import { Dialog } from '@angular/cdk/dialog';
import { RenameEntryDialog } from './rename-entry-dialog/rename-entry-dialog';
import { FileEntry, FolderEntry } from '../../data-access/entries/entry-models';

@Component({
  selector: 'app-drive',
  imports: [EntryItem, CdkMenu, CdkMenuItem, CdkContextMenuTrigger, Icon, RouterLink],
  templateUrl: './drive.html',
})
export class Drive implements OnInit {
  readonly store = inject(DriveStore);
  readonly route = inject(ActivatedRoute);
  readonly destroyRef = inject(DestroyRef);
  readonly document = inject(DOCUMENT);
  readonly dialog = inject(Dialog);

  private readonly _downloadEntryIds = signal<ReadonlySet<string>>(new Set());
  private readonly _downloadError = signal<string | null>(null);

  readonly downloadEntryIds = this._downloadEntryIds.asReadonly();
  readonly downloadError = this._downloadError.asReadonly();

  ngOnInit(): void {
    this.route.paramMap
      .pipe(
        map((params) => params.get('folderId')),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((folderId) => this.store.loadFolder(folderId));
  }

  retry(): void {
    this.store.reload();
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
      const result =
        selectedEntry.kind === 'file'
          ? await this.store.getFileDownloadUrl(selectedEntry.id)
          : await this.store.getFolderDownloadUrl(selectedEntry.id);

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

  move(selectedEntry: FolderEntry | FileEntry) {
    throw new Error('Method not implemented.');
  }

  delete(selectedEntry: FolderEntry | FileEntry) {
    throw new Error('Method not implemented.');
  }
}
