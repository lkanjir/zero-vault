import { Component, computed, input, output } from '@angular/core';
import { Icon } from '../../../shared/icon/icon';
import { FileSizePipe } from '../../../shared/pipes/file-size-pipe';
import { UploadTransfer } from '../state/transfer-models';

@Component({
  selector: 'app-transfer-panel',
  imports: [Icon, FileSizePipe],
  templateUrl: './transfer-panel.html',
})
export class TransferPanel {
  readonly open = input.required<boolean>();
  readonly dismissed = output<void>();
  readonly transfers = input.required<readonly UploadTransfer[]>();
  readonly clearRequested = output<void>();
  readonly canClear = computed(() =>
    this.transfers().some(
      (transfer) => transfer.phase === 'completed' || transfer.phase === 'failed',
    ),
  );
}
