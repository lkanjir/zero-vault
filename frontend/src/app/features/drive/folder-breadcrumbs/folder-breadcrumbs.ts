import { Component, computed, input, output } from '@angular/core';
import { FolderPathItem } from '../../../data-access/entries/entry-models';
import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { Icon } from '../../../shared/icon/icon';

@Component({
  selector: 'app-folder-breadcrumbs',
  imports: [Icon, CdkMenu, CdkMenuItem, CdkMenuTrigger],
  templateUrl: './folder-breadcrumbs.html',
  host: {
    class: 'block min-w-0',
  },
})
export class FolderBreadcrumbs {
  readonly path = input.required<readonly FolderPathItem[]>();
  readonly atRoot = input.required<boolean>();
  readonly folderSelected = output<string | null>();

  readonly ancestorFolders = computed(() => {
    const path = this.path();
    return path.length > 1 ? path.slice(0, -1) : [];
  });

  readonly currentFolder = computed(() => this.path().at(-1) ?? null);
}
