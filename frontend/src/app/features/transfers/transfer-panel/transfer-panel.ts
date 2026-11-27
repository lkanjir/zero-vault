import { Component, computed, input, output, signal } from '@angular/core';
import { Icon } from '../../../shared/icon/icon';
import { FileSizePipe } from '../../../shared/pipes/file-size-pipe';
import { UploadTransfer } from '../state/transfer-models';

@Component({
  selector: 'app-transfer-panel',
  imports: [Icon, FileSizePipe],
  templateUrl: './transfer-panel.html',
})
export class TransferPanel {
  private readonly expandedFolderIds = signal<ReadonlySet<string>>(new Set());

  readonly open = input.required<boolean>();
  readonly dismissed = output<void>();
  readonly transfers = input.required<readonly UploadTransfer[]>();
  readonly clearRequested = output<void>();
  readonly cancelRequested = output<string>();
  readonly canClear = computed(() =>
    this.transfers().some(
      (transfer) =>
        transfer.phase === 'completed' ||
        transfer.phase === 'failed' ||
        transfer.phase === 'cancelled',
    ),
  );

  isExpanded(transferId: string): boolean {
    return this.expandedFolderIds().has(transferId);
  }

  toggleExpanded(transferId: string): void {
    this.expandedFolderIds.update((current) => {
      const next = new Set(current);
      if (next.has(transferId)) {
        next.delete(transferId);
      } else {
        next.add(transferId);
      }
      return next;
    });
  }
}
