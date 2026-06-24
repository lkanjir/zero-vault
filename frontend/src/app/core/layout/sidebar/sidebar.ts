import { Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from '../../icon/icon';

@Component({
  selector: 'app-sidebar',
  imports: [RouterLink, Icon],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.css',
})
export class Sidebar {
uploadFolder() {
throw new Error('Method not implemented.');
}
uploadFile() {
throw new Error('Method not implemented.');
}
createFolder() {
throw new Error('Method not implemented.');
}
  isMenuOpen = signal<boolean>(false);

  toggleNewMenu() {
    this.isMenuOpen.update((prev) => !prev);
  }
}
