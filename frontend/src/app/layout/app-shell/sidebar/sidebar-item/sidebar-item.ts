import { Component, input } from '@angular/core';
import { Icon } from '../../../../shared/icon/icon';
import { AppIconName } from '../../../../shared/icon/icon.types';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-sidebar-item',
  imports: [Icon, RouterLink],
  templateUrl: './sidebar-item.html',
  styleUrl: './sidebar-item.css',
})
export class SidebarItem {
  readonly sidebarOpen = input.required<boolean>();
  readonly iconName = input.required<AppIconName>();
  readonly text = input.required<string>();
  readonly link = input.required<string>();
}
