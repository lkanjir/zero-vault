import { inject, Injectable, signal } from '@angular/core';
import { FolderService } from './folder-service';
import { EntryList } from './dto/entry';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class DriveStore {
  private readonly folderService = inject(FolderService);

  readonly parentId = signal<string | null>(null);
  readonly entries = signal<EntryList['items']>([]);

  async createFolder(name: string): Promise<void> {
    const folder = await firstValueFrom(
      this.folderService.createFolder({ name: name, parentKey: this.parentId() }),
    );

    this.entries.update((entries) => [folder, ...entries]);
  }
}
