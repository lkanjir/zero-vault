import { Component, inject, signal } from '@angular/core';
import { form, FormField, FormRoot, maxLength, pattern, validate } from '@angular/forms/signals';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { apiErrorMessage } from '../../../shared/api-error';
import { EntryListItem, EntryResponse } from '../../../data-access/entries/entry-models';
import { EntryActions } from '../actions/entry-actions';

export type RenameDialogData = {
  entry: EntryResponse;
};

@Component({
  selector: 'app-rename-entry-dialog',
  imports: [FormField, FormRoot],
  templateUrl: './rename-entry-dialog.html',
})
export class RenameEntryDialog {
  private readonly entryActions = inject(EntryActions);
  private readonly dialogRef = inject<DialogRef<EntryListItem>>(DialogRef);

  readonly data = inject<RenameDialogData>(DIALOG_DATA);
  readonly formModel = signal({ name: this.data.entry.name });

  readonly renameForm = form(
    this.formModel,
    (schema) => {
      maxLength(schema.name, 500, { message: 'Naziv ne može biti duži od 500 znakova' });
      pattern(schema.name, /^[^\\/]+$/, {
        message: 'Naziv ne smije sadržavati separatore putanje',
      });
      validate(schema.name, ({ value }) => {
        const name = value().trim();

        if (name.length === 0) {
          return {
            kind: 'empty_string',
            message: 'Naziv je obavezan',
          };
        }

        if (name === this.data.entry.name) {
          return {
            kind: 'unchanged_name',
            message: 'Unesi novi naziv',
          };
        }

        return undefined;
      });
    },
    {
      submission: {
        action: async (field) => {
          const result = await this.entryActions.renameEntry(
            this.data.entry.id,
            this.formModel().name.trim(),
          );

          if (result.ok) {
            this.dialogRef.close(result.value);
            return;
          }

          const message = apiErrorMessage(result.error, 'Preimenovanje nije uspjelo');

          if (result.error.code === 'duplicate_entry_name') {
            return {
              kind: result.error.code,
              message,
              fieldTree: field.name,
            };
          }

          return {
            kind: result.error.code,
            message,
          };
        },
      },
    },
  );

  closeDialog(): void {
    this.dialogRef.close();
  }
}
