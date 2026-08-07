import { Component, output } from '@angular/core';
import { Icon } from '../../../shared/icon/icon';
import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { debounceTime, distinctUntilChanged, map, Subject } from 'rxjs';
import { outputFromObservable } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-topbar',
  imports: [Icon, CdkMenu, CdkMenuItem, CdkMenuTrigger],
  templateUrl: './topbar.html',
})
export class Topbar {
  private readonly searchInput = new Subject<string>();

  readonly createFolderRequested = output<void>();
  readonly uploadFileRequested = output<void>();
  readonly uploadFolderRequested = output<void>();
  readonly searchChanged = outputFromObservable(
    this.searchInput.pipe(
      map((value) => value.trim()),
      debounceTime(300),
      distinctUntilChanged(),
    ),
  );

  onSearchInput(value: string): void {
    this.searchInput.next(value);
  }
}
