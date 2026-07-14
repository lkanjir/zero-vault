import { Component, input, output } from '@angular/core';
import { Icon } from "../../../shared/icon/icon";

@Component({
  selector: 'app-transfer-panel',
  imports: [Icon],
  templateUrl: './transfer-panel.html',
  styleUrl: './transfer-panel.css',
})
export class TransferPanel {
  readonly open = input.required<boolean>();
  readonly dismissed = output<void>();
}
