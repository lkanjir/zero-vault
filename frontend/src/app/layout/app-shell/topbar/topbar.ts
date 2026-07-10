import { Component } from '@angular/core';
import { Icon } from '../../../shared/icon/icon';
import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';

@Component({
  selector: 'app-topbar',
  imports: [Icon, CdkMenu, CdkMenuItem, CdkMenuTrigger],
  templateUrl: './topbar.html',
  styleUrl: './topbar.css',
})
export class Topbar {
uploadFile() {
throw new Error('Method not implemented.');
}
createDirectory() {
throw new Error('Method not implemented.');
}
}
