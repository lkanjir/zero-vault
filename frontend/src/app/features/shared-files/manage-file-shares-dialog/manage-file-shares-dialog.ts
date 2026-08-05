import { DatePipe } from '@angular/common';
import { Component, inject, OnInit, output, signal } from '@angular/core';
import { FileSharesStore } from '../state/file-shares-store';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { FileEntry } from '../../../data-access/entries/entry-models';
import { SharingActions } from '../actions/sharing-actions';
import { FileShare, FileSharePermission } from '../../../data-access/sharing/sharing-models';
import { apiErrorMessage } from '../../../shared/api-error';
import { Icon } from '../../../shared/icon/icon';
import { form, FormField, FormRoot, validate } from '@angular/forms/signals';

export type ManageFileSharesDialogData = {
  file: FileEntry;
};

@Component({
  selector: 'app-manage-file-shares-dialog',
  imports: [DatePipe, Icon, FormField, FormRoot],
  providers: [FileSharesStore],
  templateUrl: './manage-file-shares-dialog.html',
})
export class ManageFileSharesDialog implements OnInit {
  private readonly dialogRef = inject(DialogRef);
  private readonly sharingActions = inject(SharingActions);

  readonly data = inject<ManageFileSharesDialogData>(DIALOG_DATA);
  readonly store = inject(FileSharesStore);
  readonly pendingShareId = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly revokeCandidate = signal<FileShare | null>(null);
  readonly shareRevoked = output<void>();

  readonly editCandidate = signal<FileShare | null>(null);
  readonly updateModel = signal({ permission: 'viewer' as FileSharePermission, expiresAt: '' });
  readonly updateForm = form(
    this.updateModel,
    (schema) => {
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
        action: async () => {
          const share = this.editCandidate();

          if (share === null || this.pendingShareId() !== null) {
            return;
          }

          this.pendingShareId.set(share.shareId);
          this.error.set(null);

          const model = this.updateModel();
          const result = await this.sharingActions.updateFileShare(
            this.data.file.id,
            share.shareId,
            {
              expiresAt: model.expiresAt === '' ? null : new Date(model.expiresAt).toISOString(),
              permission: model.permission,
            },
          );

          this.pendingShareId.set(null);

          if (result.ok) {
            this.store.updateShare(result.value);
            this.editCandidate.set(null);
            return;
          }

          this.error.set(apiErrorMessage(result.error, 'Ažuriranje nije uspjelo'));
        },
      },
    },
  );

  ngOnInit(): void {
    this.store.load(this.data.file.id);
  }

  retry(): void {
    this.store.retry();
  }

  loadMore(): void {
    this.store.loadMore();
  }

  retryLoadMore(): void {
    this.store.retryLoadMore();
  }

  closeDialog(): void {
    this.dialogRef.close();
  }

  requestRevoke(share: FileShare): void {
    if (this.pendingShareId() !== null) {
      return;
    }

    this.revokeCandidate.set(share);
    this.editCandidate.set(null);
    this.error.set(null);
  }

  cancelRevoke(): void {
    if (this.pendingShareId() !== null) {
      return;
    }

    this.revokeCandidate.set(null);
    this.error.set(null);
  }

  async confirmRevoke(): Promise<void> {
    const share = this.revokeCandidate();

    if (share === null || this.pendingShareId() !== null) {
      return;
    }

    this.pendingShareId.set(share.shareId);
    this.error.set(null);

    const result = await this.sharingActions.revokeFileShare(this.data.file.id, share.shareId);
    this.pendingShareId.set(null);

    if (result.ok) {
      this.store.removeShare(share.shareId);
      this.revokeCandidate.set(null);
      this.shareRevoked.emit();
      return;
    }

    this.error.set(apiErrorMessage(result.error, 'Greška prilikom uklanjanja dijeljenja'));
  }

  requestEdit(share: FileShare): void {
    if (this.pendingShareId() !== null) {
      return;
    }

    this.revokeCandidate.set(null);
    this.error.set(null);
    this.updateForm().reset({
      permission: share.permission,
      expiresAt: this.toLocalDateTime(share.expiresAt),
    });
    this.editCandidate.set(share);
  }

  cancelEdit(): void {
    if (this.pendingShareId() !== null) {
      return;
    }

    this.editCandidate.set(null);
    this.error.set(null);
  }

  private toLocalDateTime(value: string | null): string {
    if (value === null) {
      return '';
    }

    const date = new Date(value);
    const localTimestamp = date.getTime() - date.getTimezoneOffset() * 60_000;

    return new Date(localTimestamp).toISOString().slice(0, 16);
  }
}
