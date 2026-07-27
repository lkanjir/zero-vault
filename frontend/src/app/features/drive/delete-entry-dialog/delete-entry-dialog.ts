import { Component, inject, signal } from '@angular/core';
import { EntryResponse } from '../../../data-access/entries/entry-models';
import { EntryActions } from '../actions/entry-actions';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ApiError, apiErrorMessage } from '../../../shared/api-error';

export type DeleteEntryDialogData = {
  entry: EntryResponse;
};

@Component({
  selector: 'app-delete-entry-dialog',
  imports: [],
  templateUrl: './delete-entry-dialog.html',
})
export class DeleteEntryDialog {
  private readonly entryActions = inject(EntryActions);
  private readonly dialogRef = inject(DialogRef);

  readonly data = inject<DeleteEntryDialogData>(DIALOG_DATA);
  readonly submitting = signal(false);
  readonly deleteError = signal<string | null>(null);

  async confirmDelete(): Promise<void> {
    if (this.submitting()) {
      return;
    }

    this.submitting.set(true);
    this.deleteError.set(null);

    const result = await this.entryActions.deleteEntry(this.data.entry.id);

    this.submitting.set(false);
    if (result.ok) {
      this.dialogRef.close();
      return;
    }

    this.deleteError.set(deleteErrorMessage(result.error));
  }

  closeDialog(): void {
    this.dialogRef.close();
  }
}

function deleteErrorMessage(error: ApiError): string {
  switch (error.code) {
    case 'folder_not_empty':
      return 'Direktorij nije prazan. Prvo obriši ili premjesti njegov sadržaj.';
    case 'entry_not_found':
      return 'Stavka koju pokušavaš obrisati više ne postoji.';
    default:
      return apiErrorMessage(error, 'Brisanje nije uspjelo.');
  }
}
