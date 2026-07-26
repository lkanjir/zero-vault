import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Component, inject } from '@angular/core';
import { EntryResponse } from '../../../data-access/entries/entry-models';

export type MoveEntryDialogData = {
  entry: EntryResponse;
  sourceParentId: string | null;
};

@Component({
  selector: 'app-move-entry-dialog',
  imports: [],
  templateUrl: './move-entry-dialog.html',
})
export class MoveEntryDialog {
  private readonly dialogRef = inject(DialogRef);

  readonly data = inject<MoveEntryDialogData>(DIALOG_DATA);

  closeDialog(): void {
    this.dialogRef.close();
  }
}
