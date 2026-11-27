import { Component, inject } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { Topbar } from './topbar/topbar';
import { Sidebar } from './sidebar/sidebar';
import { Dialog, DialogModule } from '@angular/cdk/dialog';
import { CreateFolderDialog } from '../../features/drive/create-folder-dialog/create-folder-dialog';
import { DriveStore } from '../../features/drive/state/drive-store';
import { TransferStore } from '../../features/transfers/state/transfer-store';
import { TransferPanel } from '../../features/transfers/transfer-panel/transfer-panel';
import { scanDirectoryInputFiles } from '../../features/transfers/folder-upload-scanner';
import { AuthService } from '../../auth/auth-service';
import { EntryKindFilter } from '../../data-access/entries/entry-models';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';

@Component({
  selector: 'app-app-shell',
  imports: [RouterOutlet, Topbar, Sidebar, DialogModule, TransferPanel],
  templateUrl: './app-shell.html',
})
export class AppShell {
  private readonly dialog = inject(Dialog);
  private readonly router = inject(Router);

  readonly driveStore = inject(DriveStore);
  readonly transferStore = inject(TransferStore);
  readonly authService = inject(AuthService);

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
    const files = Array.from(input.files ?? []);

    input.value = '';
    if (files.length === 0) {
      return;
    }

    const targetParentId = this.driveStore.parentId();
    const result = await this.transferStore.startUploads(files, targetParentId);

    if (result.some((result) => result.ok)) {
      this.driveStore.reloadIfCurrent(targetParentId);
    }
  }

  async onFolderChanged(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);

    input.value = '';
    if (files.length === 0) {
      return;
    }

    const batches = scanDirectoryInputFiles(files);
    if (batches.length === 0) {
      return;
    }

    const targetParentId = this.driveStore.parentId();
    const results = await Promise.all(
      batches.map((batch) => this.transferStore.startFolderUpload(batch, targetParentId)),
    );

    if (results.some((result) => result.createdFolders || result.completedFiles > 0)) {
      this.driveStore.reloadIfCurrent(targetParentId);
    }
  }

  toggleTransfers() {
    this.transferStore.togglePanel();
  }

  closeTransfers() {
    this.transferStore.closePanel();
  }

  logout(): Promise<void> {
    return this.authService.logout();
  }

  onSearchChanged(value: string): void {
    this.driveStore.setSearch(value);
  }

  onKindChanged(kind: EntryKindFilter): void {
    this.driveStore.setKind(kind);
  }

  readonly isDriveRoute = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects.startsWith('/drive')),
    ),
    {
      initialValue: this.router.url.startsWith('/drive'),
    },
  );
}
