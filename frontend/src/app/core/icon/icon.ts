import { Component, input } from '@angular/core';

export type IconTypes = "files" | 'shared' | 'account' | 'panel-open' | 'panel-close' | 'search'

@Component({
  selector: 'app-icon',
  imports: [],
  templateUrl: './icon.html',
  styleUrl: './icon.css',
})
export class Icon {
  name = input<IconTypes>('files');
}
