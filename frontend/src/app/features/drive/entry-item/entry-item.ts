import { Component, computed, input } from '@angular/core';
import { Icon } from '../../../shared/icon/icon';
import { Folder } from '../dto/folder';
import type { File } from '../dto/file';
import { FileSizePipe } from "../../../shared/pipes/file-size-pipe";

@Component({
  selector: 'tr[app-entry-item]',
  imports: [Icon, FileSizePipe],
  templateUrl: './entry-item.html',
  styleUrl: './entry-item.css',
  host: {
    class: 'hover:bg-surface-hover',
  },
})
export class EntryItem {
  readonly entry = input.required<Folder | File>();
}
