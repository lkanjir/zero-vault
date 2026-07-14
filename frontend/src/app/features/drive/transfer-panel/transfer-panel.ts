import { Component, input, output, signal } from '@angular/core';
import { Icon } from '../../../shared/icon/icon';

@Component({
  selector: 'app-transfer-panel',
  imports: [Icon],
  templateUrl: './transfer-panel.html',
})
export class TransferPanel {
  readonly open = input.required<boolean>();
  readonly dismissed = output<void>();
  readonly transfer = signal({
    fileName: 'slika.jpfdsaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaag',
    sizeLabel: '2.89MB',
    speedLabel: '26KB/s',
    progress: 18,
  });
}
