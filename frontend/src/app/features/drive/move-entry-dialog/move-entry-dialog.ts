import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { EntryResponse, FolderEntry } from '../../../data-access/entries/entry-models';
import { MoveStore } from './move-store';
import { Icon } from '../../../shared/icon/icon';
import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { ApiError, apiErrorMessage } from '../../../shared/api-error';
import { EntryActions } from '../actions/entry-actions';
import { retry } from 'rxjs';

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
  private readonly entryActins = inject(EntryActions);
  private readonly dialogRef = inject(DialogRef);

  readonly data = inject<MoveEntryDialogData>(DIALOG_DATA);
  readonly store = inject(MoveStore);

  readonly ancestorFolders = computed(() => {
    const path = this.store.path();
    return path.length > 1 ? path.slice(0, -1) : [];
  });
  readonly currentFolder = computed(() => this.store.path().at(-1) ?? null);
  readonly submitting = signal(false);
  readonly moveError = signal<string | null>(null);
  readonly canMove = computed(
    () =>
      !this.store.loading() &&
      this.store.error() === null &&
      !this.submitting() &&
      this.store.parentId() !== this.data.sourceParentId,
  );

  ngOnInit(): void {
    this.store.loadFolder(this.data.sourceParentId);
  }

  isBlockedFolder(folder: FolderEntry): boolean {
    return this.data.entry.kind === 'folder' && this.data.entry.id === folder.id;
  }

  navigateTo(parentId: string | null): void {
    if (this.submitting()) {
      return;
    }

    this.moveError.set(null);
    this.store.loadFolder(parentId);
  }

  async confirmMove(): Promise<void> {
    if (!this.canMove()) {
      return;
    }

    const targetParentId = this.store.parentId();
    this.submitting.set(true);
    this.moveError.set(null);

    const result = await this.entryActins.moveEntry({
      entryId: this.data.entry.id,
      sourceParentId: this.data.sourceParentId,
      targetParentId,
    });

    this.submitting.set(false);

    if (result.ok) {
      this.closeDialog();
      return;
    }

    this.moveError.set(moveErrorMessage(result.error));
  }

  closeDialog(): void {
    this.dialogRef.close();
  }
}

function moveErrorMessage(error: ApiError): string {
  switch (error.code) {
    case 'duplicate_entry_name':
      return 'U odredišnom direktoriju već postoji stavka s tim nazivom.';
    case 'move_would_create_cycle':
      return 'Direktorij nije moguće premjestiti u njegov poddirektorij.';
    case 'entry_not_found':
      return 'Stavka koju premještaš više ne postoji.';
    case 'folder_not_found':
      return 'Odredišni direktorij više ne postoji.';
    default:
      return apiErrorMessage(error, 'Premještanje nije uspjelo.');
  }
}
