import { Component, input } from '@angular/core';
import { Icon } from '../../../shared/icon/icon';
import { FileSizePipe } from '../../../shared/pipes/file-size-pipe';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FileEntry, FolderEntry } from '../../../data-access/entries/entry-models';

@Component({
  selector: 'tr[app-entry-item]',
  imports: [Icon, FileSizePipe, DatePipe, RouterLink],
  templateUrl: './entry-item.html',
  host: {
    class: 'hover:bg-surface-hover',
  },
})
export class EntryItem {
  readonly entry = input.required<FolderEntry | FileEntry>();
}
