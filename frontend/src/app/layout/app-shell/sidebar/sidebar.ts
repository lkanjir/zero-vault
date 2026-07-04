import { Component, signal } from '@angular/core';
import { Icon } from '../../../shared/icon/icon';

@Component({
  selector: 'app-sidebar',
  imports: [Icon],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.css',
})
export class Sidebar {
  open = signal<boolean>(false);
  toggleOpen() {
    this.open.update((current) => !current);
  }
}
