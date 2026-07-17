import { Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Topbar } from './topbar/topbar';
import { Sidebar } from './sidebar/sidebar';
import { Dialog, DialogModule } from '@angular/cdk/dialog';
import { CreateFolderDialog } from '../../features/drive/create-folder-dialog/create-folder-dialog';
import { DriveStore } from '../../features/drive/drive-store';
import { TransferPanel } from '../../features/drive/transfer-panel/transfer-panel';
import { TransferStore } from '../../features/drive/transfers/transfer-store';

@Component({
  selector: 'app-app-shell',
  imports: [RouterOutlet, Topbar, Sidebar, DialogModule, TransferPanel],
  templateUrl: './app-shell.html',
})
export class AppShell {
  private readonly dialog = inject(Dialog);
  private readonly driveStore = inject(DriveStore);
  readonly transferStore = inject(TransferStore);

  readonly transfersOpen = signal(false);

  openCreateFolderDialog(): void {
    this.dialog.open(CreateFolderDialog, {
      width: 'calc(100vw - 2rem)',
      maxWidth: '28rem',
      autoFocus: 'first-tabbable',
      restoreFocus: true,
    });
  }

  async onFileChanged(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.item(0);

    input.value = '';
    if (!file) return;

    const targetParentId = this.driveStore.parentId();
    this.transfersOpen.set(true);

    const result = await this.transferStore.startUplaod(file, targetParentId);

    if (result.ok) {
      this.driveStore.reloadIfCurrent(targetParentId);
    }
  }

  toggleTransfers() {
    this.transfersOpen.update((curr) => !curr);
  }

  closeTransfers() {
    this.transfersOpen.set(false);
  }
}
