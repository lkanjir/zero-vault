import { Component, inject, signal } from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';
import {
  debounce,
  form,
  FormField,
  FormRoot,
  maxLength,
  pattern,
  validate,
} from '@angular/forms/signals';
import { apiErrorMessage } from '../../../shared/api-error';
import { EntryActions } from '../actions/entry-actions';

@Component({
  selector: 'app-create-folder-dialog',
  imports: [FormField, FormRoot],
  templateUrl: './create-folder-dialog.html',
})
export class CreateFolderDialog {
  private readonly entryActions = inject(EntryActions);
  readonly dialogRef = inject(DialogRef);

  readonly formModel = signal({ name: '' });
  readonly createFolderForm = form(
    this.formModel,
    (schema) => {
      debounce(schema.name, 150);
      maxLength(schema.name, 500, {
        message: 'Naziv direktorija može ne može biti duži od 500 znakova',
      });
      pattern(schema.name, /^[^\\/]+$/, {
        message: 'Naziv ne smije sadržavati separatore putanje',
      });
      validate(schema.name, ({ value }) => {
        if (value().trim().length === 0) {
          return {
            kind: 'emtpy-string',
            message: 'Naziv direktorija je obavezan',
          };
        }

        return null;
      });
    },
    {
      submission: {
        action: async (field) => {
          const result = await this.entryActions.createFolder(this.formModel().name.trim());
          if (result.ok) {
            this.dialogRef.close();
            return;
          }

          const message = apiErrorMessage(result.error, 'Nije moguće kreirati direktorij');
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

  closeDialog() {
    this.dialogRef.close();
  }
}
