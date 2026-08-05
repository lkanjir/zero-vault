import { DatePipe } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FileSharesStore } from '../state/file-shares-store';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { FileEntry } from '../../../data-access/entries/entry-models';
import { SharingActions } from '../actions/sharing-actions';
import { FileShare } from '../../../data-access/sharing/sharing-models';
import { apiErrorMessage } from '../../../shared/api-error';
import { Icon } from '../../../shared/icon/icon';

export type ManageFileSharesDialogData = {
  file: FileEntry;
};

@Component({
  selector: 'app-manage-file-shares-dialog',
  imports: [DatePipe, Icon],
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
      return;
    }

    this.error.set(apiErrorMessage(result.error, 'Greška prilikom uklanjanja dijeljenja'));
  }
}
