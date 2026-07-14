import { Component, output, signal } from '@angular/core';
import { Icon } from '../../../shared/icon/icon';
import { SidebarItem } from './sidebar-item/sidebar-item';

@Component({
  selector: 'app-sidebar',
  imports: [Icon, SidebarItem],
  templateUrl: './sidebar.html',
  host: {
    class:
      'block h-full shrink-0 overflow-hidden border-r border-border bg-surface transition-[width] duration-200',
    '[class.w-16]': '!open()',
    '[class.w-72]': 'open()',
  },
})
export class Sidebar {
  readonly open = signal<boolean>(false);
  readonly transfersRequested = output<void>();

  toggleOpen() {
    this.open.update((current) => !current);
  }
}
