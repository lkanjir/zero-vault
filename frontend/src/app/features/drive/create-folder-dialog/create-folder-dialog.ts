import { Component, inject, signal } from '@angular/core';
import { DriveStore } from '../drive-store';
import { DialogRef } from '@angular/cdk/dialog';
import {
  debounce,
  form,
  FormField,
  maxLength,
  minLength,
  pattern,
  required,
} from '@angular/forms/signals';
import { SignalFormControl } from '@angular/forms/signals/compat';

@Component({
  selector: 'app-create-folder-dialog',
  imports: [FormField],
  templateUrl: './create-folder-dialog.html',
  styleUrl: './create-folder-dialog.css',
})
export class CreateFolderDialog {
  private readonly store = inject(DriveStore);
  readonly dialogRef = inject(DialogRef);
  readonly error = signal<string | null>(null);

  readonly formModel = signal({ name: '' });
  readonly createFolderForm = form(this.formModel, (schema) => {
    debounce(schema.name, 150);
    required(schema.name, { message: 'Naziv direktorija je obavezan' });
    maxLength(schema.name, 500, {
      message: 'Naziv direktorija može ne može biti duži od 500 znakova',
    });
    pattern(schema.name, /^[^\\/]+$/, { message: 'Naziv ne smije sadržavati separatore putanje' });
  });

  async onSubmit(event: Event) {
    event.preventDefault();

    try {
      this.error.set(null);
      await this.store.createFolder(this.formModel().name.trim());
      this.dialogRef.close();
    } catch {
      this.error.set('Nije moguće kreirati direktorij');
    }
  }

  closeDialog() {
    this.dialogRef.close();
  }
}
