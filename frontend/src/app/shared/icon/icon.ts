import { Component, input } from '@angular/core';
import { AppIconName } from './icon.types';
import { LucideDynamicIcon } from '@lucide/angular';

@Component({
  selector: 'app-icon',
  imports: [LucideDynamicIcon],
  templateUrl: './icon.html',
  host: {
    class: 'inline-flex shrink-0 items-center justify-center align-middle leading-none',
  },
})
export class Icon {
  readonly name = input.required<AppIconName>();
  readonly size = input(24);
  readonly stroke = input(2);
}
