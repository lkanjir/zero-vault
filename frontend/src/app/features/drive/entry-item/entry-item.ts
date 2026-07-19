import { Component, computed, input } from '@angular/core';
import { Icon } from '../../../shared/icon/icon';
import { FolderEntry } from '../dto/folder';
import type { FileEntry } from '../dto/file';
import { FileSizePipe } from '../../../shared/pipes/file-size-pipe';
import { DatePipe } from '@angular/common';

@Component({
  selector: 'tr[app-entry-item]',
  imports: [Icon, FileSizePipe, DatePipe],
  templateUrl: './entry-item.html',
  styleUrl: './entry-item.css',
  host: {
    class: 'hover:bg-surface-hover',
  },
})
export class EntryItem {
  readonly entry = input.required<FolderEntry | FileEntry>();
}
