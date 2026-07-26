import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Component, inject, OnInit } from '@angular/core';
import { EntryResponse } from '../../../data-access/entries/entry-models';
import { MoveStore } from './move-store';

export type MoveEntryDialogData = {
  entry: EntryResponse;
  sourceParentId: string | null;
};

@Component({
  selector: 'app-move-entry-dialog',
  imports: [],
  providers: [MoveStore],
  templateUrl: './move-entry-dialog.html',
})
export class MoveEntryDialog implements OnInit {
  private readonly dialogRef = inject(DialogRef);

  readonly data = inject<MoveEntryDialogData>(DIALOG_DATA);
  readonly store = inject(MoveStore);

  ngOnInit(): void {
    this.store.loadFolder(this.data.sourceParentId);
  }

  closeDialog(): void {
    this.dialogRef.close();
  }
}
