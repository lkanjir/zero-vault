import { Component, inject, signal } from '@angular/core';
import { FileEntry } from '../../../data-access/entries/entry-models';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import {
  email,
  form,
  FormField,
  FormRoot,
  maxLength,
  required,
  validate,
} from '@angular/forms/signals';
import { apiErrorMessage } from '../../../shared/api-error';
import { FileSharePermission } from '../../../data-access/sharing/sharing-models';
import { SharingActions } from '../actions/sharing-actions';

export type ShareFileDialogData = {
  file: FileEntry;
};

@Component({
  selector: 'app-share-file-dialog',
  imports: [FormField, FormRoot],
  templateUrl: './share-file-dialog.html',
})
export class ShareFileDialog {
  private readonly sharingActions = inject(SharingActions);
  private readonly dialogRef = inject(DialogRef);

  readonly data = inject<ShareFileDialogData>(DIALOG_DATA);
  readonly formModel = signal({
    recipientEmail: '',
    permission: 'viewer' as FileSharePermission,
    expiresAt: '',
  });
  readonly shareForm = form(
    this.formModel,
    (schema) => {
      required(schema.recipientEmail, { message: 'E-pošta primatelja je obavezna' });
      email(schema.recipientEmail, { message: 'Unesi ispravnu adresu e-pošte' });
      maxLength(schema.recipientEmail, 254, {
        message: 'Adresa e-pošte ne može biti duža od 254 znaka',
      });

      validate(schema.expiresAt, ({ value }) => {
        const expiresAt = value();
        if (expiresAt === '') {
          return undefined;
        }

        const timestamp = new Date(expiresAt).getTime();
        if (!Number.isFinite(timestamp) || timestamp <= Date.now()) {
          return {
            kind: 'invalid_grant_expiry',
            message: 'Vrijeme isteka mora biti u budućnosti',
          };
        }

        return undefined;
      });
    },
    {
      submission: {
        action: async (field) => {
          const model = this.formModel();
          const result = await this.sharingActions.shareFile(this.data.file.id, {
            recipientEmail: model.recipientEmail.trim().toLowerCase(),
            permission: model.permission,
            expiresAt: model.expiresAt === '' ? null : new Date(model.expiresAt).toISOString(),
          });

          if (result.ok) {
            this.dialogRef.close();
            return;
          }

          const message = apiErrorMessage(result.error, 'Dijeljenje datoteke nije uspjelo');
          if (result.error.code === 'invalid_grant_expiry') {
            return {
              kind: result.error.code,
              message,
              fieldTree: field.expiresAt,
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
