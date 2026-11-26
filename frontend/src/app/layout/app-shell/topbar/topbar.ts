import { Component, input, output } from '@angular/core';
import { Icon } from '../../../shared/icon/icon';
import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { debounceTime, map, Subject } from 'rxjs';
import { outputFromObservable } from '@angular/core/rxjs-interop';
import { EntryKindFilter } from '../../../data-access/entries/entry-models';

@Component({
  selector: 'app-topbar',
  imports: [Icon, CdkMenu, CdkMenuItem, CdkMenuTrigger],
  templateUrl: './topbar.html',
})
export class Topbar {
  private readonly searchInput = new Subject<string>();

  readonly search = input<string>('');
  readonly kind = input<EntryKindFilter>(null);

  readonly createFolderRequested = output<void>();
  readonly uploadFileRequested = output<void>();

  readonly searchChanged = outputFromObservable(
    this.searchInput.pipe(
      map((value) => value.trim()),
      debounceTime(300),
    ),
  );

  onSearchInput(value: string): void {
    this.searchInput.next(value);
  }

  readonly kindChanged = output<EntryKindFilter>();
  onKindChanged(value: string): void {
    if (value === 'file' || value === 'folder') {
      this.kindChanged.emit(value);
      return;
    }

    this.kindChanged.emit(null);
  }
}
