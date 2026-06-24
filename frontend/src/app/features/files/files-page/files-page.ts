import { Component } from '@angular/core';

export type FileListItem = {
  fileName: string;
  sizeBytes: number;
  modifiedAt: Date;
};

@Component({
  selector: 'app-files-page',
  imports: [],
  templateUrl: './files-page.html',
  styleUrl: './files-page.css',
})
export class FilesPage {
  mockFiles: FileListItem[] = [
    {
      fileName: 'initial-prompt.txt',
      sizeBytes: 18432,
      modifiedAt: new Date('2026-06-23T10:30:00'),
    },
    {
      fileName: 'vault-design.pdf',
      sizeBytes: 2_430_000,
      modifiedAt: new Date('2026-06-22T15:10:00'),
    },
  ];
}
