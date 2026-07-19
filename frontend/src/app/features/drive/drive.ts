import { Component, DestroyRef, inject, OnInit, Signal, signal } from '@angular/core';
import { EntryService } from './entry-service';
import { EntryList } from './dto/entry';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize, single } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { EntryItem } from './entry-item/entry-item';
import { FileEntry } from './dto/file';
import { Folder } from './dto/folder';
import { CdkContextMenuTrigger, CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { Icon } from '../../shared/icon/icon';
import { DriveStore } from './drive-store';

@Component({
  selector: 'app-drive',
  imports: [EntryItem, CdkMenu, CdkMenuItem, CdkContextMenuTrigger, Icon],
  templateUrl: './drive.html',
  styleUrl: './drive.css',
})
export class Drive implements OnInit {
  readonly store = inject(DriveStore);

  ngOnInit(): void {
    this.store.loadFolder(null);
  }

  retry() {
    this.store.reload();
  }

  download(selectedEntry: Folder | FileEntry) {
    // this.store.download(selectedEntry);
  }

  rename(selectedEntry: Folder | FileEntry) {
    throw new Error('Method not implemented.');
  }

  move(selectedEntry: Folder | FileEntry) {
    throw new Error('Method not implemented.');
  }

  delete(selectedEntry: Folder | FileEntry) {
    throw new Error('Method not implemented.');
  }
}
