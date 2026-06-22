import { Component, inject, signal } from '@angular/core';
import { UploadService } from './upload-service';
import { UploadData } from './uploadData';
import { form, FormRoot, FormField } from '@angular/forms/signals';

@Component({
  selector: 'app-upload',
  imports: [FormRoot, FormField],
  templateUrl: './upload.html',
  styleUrl: './upload.css',
})
export class Upload {
  private readonly service = inject(UploadService);

  uploadModel = signal<UploadData>({
    fileName: '',
  });

  presignedUrl = signal<string>('');

  uploadForm = form(this.uploadModel, {
    submission: {
      action: async (field) => {
        const result = this.service.createPresignedUrl({ contentType: 'text/plain', fileName: this.fileName() })
        result.subscribe({
          next: (data) => {
            this.presignedUrl.set(data.uploadUrl);
            
            this.service.upload(this.presignedUrl(), this.selectedFile()!).subscribe();
          }
        })
      }
    }
  });

  selectedFile = signal<File | null>(null)
  fileName = signal<string>('');

  selectFile($event: Event) {
    const input = $event?.target as HTMLInputElement;
    this.fileName.set(input.files?.[0].name!);
    this.selectedFile.set(input.files?.[0] ?? null)
  }
}
