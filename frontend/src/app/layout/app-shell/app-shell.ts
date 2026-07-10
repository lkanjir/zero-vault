import { Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Topbar } from './topbar/topbar';
import { Sidebar } from './sidebar/sidebar';
import { Dialog, DialogModule } from '@angular/cdk/dialog';
import { CreateFolderDialog } from '../../features/drive/create-folder-dialog/create-folder-dialog';

@Component({
  selector: 'app-app-shell',
  imports: [RouterOutlet, Topbar, Sidebar, DialogModule],
  templateUrl: './app-shell.html',
  styleUrl: './app-shell.css',
})
export class AppShell {
  private readonly dialog = inject(Dialog);

  openCreateFolderDialog(): void {
    this.dialog.open(CreateFolderDialog, {
      width: 'calc(100vw - 2rem)',
      maxWidth: '28rem',
      autoFocus: 'first-tabbable',
      restoreFocus: true,
    });
  }
}
