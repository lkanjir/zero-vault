import { Component, DestroyRef, inject, OnInit, Signal, signal } from '@angular/core';
import { EntryItem } from './entry-item/entry-item';
import { FileEntry } from './dto/file';
import { FolderEntry } from './dto/folder';
import { CdkContextMenuTrigger, CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { Icon } from '../../shared/icon/icon';
import { DriveStore } from './drive-store';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { distinctUntilChanged, map, Observable } from 'rxjs';
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
