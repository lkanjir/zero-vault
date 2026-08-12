import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import {
  AfterViewInit,
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
  TrackByFunction,
  viewChild,
} from '@angular/core';
import { EntryResponse, FolderEntry } from '../../../data-access/entries/entry-models';
import { MoveStore } from './move-store';
import { Icon } from '../../../shared/icon/icon';
import { ApiError, apiErrorMessage } from '../../../shared/api-error';
import { EntryActions } from '../actions/entry-actions';
import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FolderBreadcrumbs } from '../folder-breadcrumbs/folder-breadcrumbs';

export type MoveEntryDialogData = {
  entry: EntryResponse;
  sourceParentId: string | null;
};

const LOAD_MORE_THRESHOLD = 10;

@Component({
  selector: 'app-move-entry-dialog',
  imports: [Icon, ScrollingModule, FolderBreadcrumbs],
  providers: [MoveStore],
  templateUrl: './move-entry-dialog.html',
})
export class MoveEntryDialog implements OnInit, AfterViewInit {
  private readonly entryActions = inject(EntryActions);
  private readonly dialogRef = inject(DialogRef);
  private readonly destroyRef = inject(DestroyRef);

  readonly data = inject<MoveEntryDialogData>(DIALOG_DATA);
  readonly store = inject(MoveStore);
  readonly viewport = viewChild.required(CdkVirtualScrollViewport);

  readonly submitting = signal(false);
  readonly moveError = signal<string | null>(null);
  readonly canMove = computed(
    () =>
      !this.store.loading() &&
      this.store.error() === null &&
      !this.submitting() &&
      this.store.parentId() !== this.data.sourceParentId,
  );

  readonly trackFolder: TrackByFunction<FolderEntry> = (_index, folder) => folder.id;

  ngOnInit(): void {
    this.store.loadFolder(this.data.sourceParentId);
  }

  ngAfterViewInit(): void {
    this.viewport()
      .renderedRangeStream.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ end }) => {
        const remainingCount = this.store.folders().length - end;

        if (this.store.folders().length > 0 && remainingCount <= LOAD_MORE_THRESHOLD) {
          this.store.loadMore();
        }
      });
  }

  isBlockedFolder(folder: FolderEntry): boolean {
    return this.data.entry.kind === 'folder' && this.data.entry.id === folder.id;
  }

  navigateTo(parentId: string | null): void {
    if (this.submitting()) {
      return;
    }

    this.moveError.set(null);
    this.viewport().scrollToIndex(0);
    this.store.loadFolder(parentId);
  }

  async confirmMove(): Promise<void> {
    if (!this.canMove()) {
      return;
    }

    const targetParentId = this.store.parentId();
    this.submitting.set(true);
    this.moveError.set(null);

    const result = await this.entryActions.moveEntry({
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
