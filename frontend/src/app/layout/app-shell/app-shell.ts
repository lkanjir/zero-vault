import { Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Topbar } from './topbar/topbar';
import { Sidebar } from './sidebar/sidebar';
import { Dialog, DialogModule } from '@angular/cdk/dialog';
import { CreateFolderDialog } from '../../features/drive/create-folder-dialog/create-folder-dialog';
import { DriveStore } from '../../features/drive/drive-store';

@Component({
  selector: 'app-app-shell',
  imports: [RouterOutlet, Topbar, Sidebar, DialogModule],
  templateUrl: './app-shell.html',
  styleUrl: './app-shell.css',
})
export class AppShell {
  private readonly dialog = inject(Dialog);
  private readonly store = inject(DriveStore);

  openCreateFolderDialog(): void {
    this.dialog.open(CreateFolderDialog, {
      width: 'calc(100vw - 2rem)',
      maxWidth: '28rem',
      autoFocus: 'first-tabbable',
      restoreFocus: true,
    });
  }

  async onFileChanged(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.item(0);

    if (file) {
      await this.store.uploadFile(file);
    }
  }
}
