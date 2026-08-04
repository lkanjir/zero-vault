import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-shared-files-layout',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './shared-files-layout.html',
  host: {
    class: 'block h-full min-h-0',
  },
})
export class SharedFilesLayout {}
