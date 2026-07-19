import { Component, DestroyRef, inject, OnInit, Signal, signal } from '@angular/core';
import { EntryItem } from './entry-item/entry-item';
import { FileEntry } from './dto/file';
import { FolderEntry } from './dto/folder';
import { CdkContextMenuTrigger, CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { Icon } from '../../shared/icon/icon';
import { DriveStore } from './drive-store';

@Component({
  selector: 'app-drive',
  imports: [EntryItem, CdkMenu, CdkMenuItem, CdkContextMenuTrigger, Icon],
  templateUrl: './drive.html',
})
export class Drive implements OnInit {
  readonly store = inject(DriveStore);

  ngOnInit(): void {
    this.store.loadFolder(null);
  }

  retry() {
    this.store.reload();
  }

  download(selectedEntry: FolderEntry | FileEntry) {
    // this.store.download(selectedEntry);
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
