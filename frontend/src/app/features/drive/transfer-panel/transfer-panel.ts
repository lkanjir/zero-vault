import { Component, input, output, signal } from '@angular/core';
import { Icon } from '../../../shared/icon/icon';
import { UploadTransfer } from '../transfers/transfer';
import { FileSizePipe } from '../../../shared/pipes/file-size-pipe';

@Component({
  selector: 'app-transfer-panel',
  imports: [Icon, FileSizePipe],
  templateUrl: './transfer-panel.html',
})
export class TransferPanel {
  readonly open = input.required<boolean>();
  readonly dismissed = output<void>();
  readonly transfers = input.required<readonly UploadTransfer[]>();
}
