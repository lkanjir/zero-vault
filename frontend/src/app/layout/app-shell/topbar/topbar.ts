import { Component, output } from '@angular/core';
import { Icon } from '../../../shared/icon/icon';
import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';

@Component({
  selector: 'app-topbar',
  imports: [Icon, CdkMenu, CdkMenuItem, CdkMenuTrigger],
  templateUrl: './topbar.html',
})
export class Topbar {
  readonly createFolderRequested = output<void>();
  readonly uploadFileRequested = output<void>();
  readonly uploadFolderRequested = output<void>();
}
