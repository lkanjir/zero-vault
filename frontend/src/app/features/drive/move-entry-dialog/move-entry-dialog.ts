import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Component, computed, inject, OnInit } from '@angular/core';
import { EntryResponse, FolderEntry } from '../../../data-access/entries/entry-models';
import { MoveStore } from './move-store';
import { Icon } from '../../../shared/icon/icon';
import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';

export type MoveEntryDialogData = {
  entry: EntryResponse;
  sourceParentId: string | null;
};

@Component({
  selector: 'app-move-entry-dialog',
  imports: [Icon, CdkMenu, CdkMenuTrigger, CdkMenuItem],
  providers: [MoveStore],
  templateUrl: './move-entry-dialog.html',
})
export class MoveEntryDialog implements OnInit {
  private readonly dialogRef = inject(DialogRef);
  readonly data = inject<MoveEntryDialogData>(DIALOG_DATA);
  readonly store = inject(MoveStore);

  readonly ancestorFolders = computed(() => {
    const path = this.store.path();
    return path.length > 1 ? path.slice(0, -1) : [];
  });

  readonly currentFolder = computed(() => this.store.path().at(-1) ?? null);

  ngOnInit(): void {
    this.store.loadFolder(this.data.sourceParentId);
  }

  isBlockedFolder(folder: FolderEntry): boolean {
    return this.data.entry.kind === 'folder' && this.data.entry.id === folder.id;
  }

  closeDialog(): void {
    this.dialogRef.close();
  }
}
