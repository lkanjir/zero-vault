import { Component, DestroyRef, DOCUMENT, inject, OnInit } from '@angular/core';
import { EntryItem } from './entry-item/entry-item';
import { FileEntry } from './dto/file';
import { FolderEntry } from './dto/folder';
import { CdkContextMenuTrigger, CdkMenu, CdkMenuItem } from '@angular/cdk/menu';
import { Icon } from '../../shared/icon/icon';
import { DriveStore } from './drive-store';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { distinctUntilChanged, map } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

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

  ngOnInit(): void {
    this.route.paramMap
      .pipe(
        map((params) => params.get('folderId')),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((folderId) => this.store.loadFolder(folderId));
  }

  retry() {
    this.store.reload();
  }

  async download(selectedEntry: FolderEntry | FileEntry): Promise<void> {
    const result =
      selectedEntry.kind === 'file'
        ? await this.store.getFileDownloadUrl(selectedEntry.id)
        : await this.store.getFolderDownloadUrl(selectedEntry.id);

    if (!result.ok) {
      console.error('Download failed', result.error);
      return;
    }

    const link = this.document.createElement('a');
    link.href = result.value;
    link.style.display = 'none';

    this.document.body.append(link);
    link.click();
    link.remove();
  }

  rename(selectedEntry: FolderEntry | FileEntry) {
    throw new Error('Method not implemented.');
  }

  move(selectedEntry: FolderEntry | FileEntry) {
    throw new Error('Method not implemented.');
  }

  delete(selectedEntry: FolderEntry | FileEntry) {
    throw new Error('Method not implemented.');
  }
}
