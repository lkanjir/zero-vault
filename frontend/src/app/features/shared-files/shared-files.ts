import { Component, inject, OnInit } from '@angular/core';
import { SharedFileStore } from './state/shared-files-store';

@Component({
  selector: 'app-shared-files',
  imports: [],
  templateUrl: './shared-files.html',
})
export class SharedFiles implements OnInit {
  readonly store = inject(SharedFileStore);

  ngOnInit(): void {
    this.store.load();
  }

  retry(): void {
    this.store.retry();
  }
}
