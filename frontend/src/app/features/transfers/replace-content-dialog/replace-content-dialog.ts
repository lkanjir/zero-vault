import { Component, computed, inject, signal } from '@angular/core';
import { FileEntry } from '../../../data-access/entries/entry-models';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { FileSizePipe } from '../../../shared/pipes/file-size-pipe';
import { fileExtension } from '../../../shared/util/file-extension';
import { MAX_UPLOAD_SIZE_BYTES } from '../../../data-access/uploads/upload-constraints';

export type ReplaceContentDialogData = {
  targetFile: FileEntry;
};

@Component({
  selector: 'app-replace-content-dialog',
  imports: [FileSizePipe],
  templateUrl: './replace-content-dialog.html',
})
export class ReplaceContentDialog {
  private readonly dialogRef = inject<DialogRef<File>>(DialogRef);

  readonly data = inject<ReplaceContentDialogData>(DIALOG_DATA);
  readonly selectedFile = signal<File | null>(null);
  readonly selectionError = signal<string | null>(null);
  readonly hasDifferentExtension = computed(() => {
    const selectedFile = this.selectedFile();

    if (selectedFile === null) {
      return false;
    }

    return fileExtension(selectedFile.name) !== fileExtension(this.data.targetFile.name);
  });

  fileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.item(0) ?? null;

    input.value = '';
    this.selectedFile.set(null);
    this.selectionError.set(null);

    if (file === null) {
      return;
    }

    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      this.selectionError.set('Datoteka ne može biti veća od 512 GB.');
      return;
    }

    this.selectedFile.set(file);
  }

  confirm(): void {
    const file = this.selectedFile();
    if (file !== null) {
      this.dialogRef.close(file);
    }
  }

  closeDialog(): void {
    this.dialogRef.close();
  }
}
