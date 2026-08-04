import { DatePipe } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { FileSharesStore } from '../state/file-shares-store';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { FileEntry } from '../../../data-access/entries/entry-models';

export type ManageFileSharesDialogData = {
  file: FileEntry;
};

@Component({
  selector: 'app-manage-file-shares-dialog',
  imports: [DatePipe],
  providers: [FileSharesStore],
  templateUrl: './manage-file-shares-dialog.html',
})
export class ManageFileSharesDialog implements OnInit {
  private readonly dialogRef = inject(DialogRef);

  readonly data = inject<ManageFileSharesDialogData>(DIALOG_DATA);
  readonly store = inject(FileSharesStore);

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
}
