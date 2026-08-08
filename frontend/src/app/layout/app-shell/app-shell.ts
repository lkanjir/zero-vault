import { Component, inject } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { Topbar } from './topbar/topbar';
import { Sidebar } from './sidebar/sidebar';
import { Dialog, DialogModule } from '@angular/cdk/dialog';
import { CreateFolderDialog } from '../../features/drive/create-folder-dialog/create-folder-dialog';
import { DriveStore } from '../../features/drive/state/drive-store';
import { TransferStore } from '../../features/transfers/state/transfer-store';
import { TransferPanel } from '../../features/transfers/transfer-panel/transfer-panel';
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
  private readonly driveStore = inject(DriveStore);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  readonly transferStore = inject(TransferStore);

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
