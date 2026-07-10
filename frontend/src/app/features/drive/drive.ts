import { Component, DestroyRef, inject, OnInit, Signal, signal } from '@angular/core';
import { EntryService } from './entry-service';
import { EntryList } from './dto/entry';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize, single } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { EntryItem } from './entry-item/entry-item';
import { File } from './dto/file';
import { Folder } from './dto/folder';

@Component({
  selector: 'app-drive',
  imports: [EntryItem, ],
  templateUrl: './drive.html',
  styleUrl: './drive.css',
})
export class Drive implements OnInit {
  private readonly entryService = inject(EntryService);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly entries = signal<EntryList['items']>([]);
  readonly nextCursor = signal<string | null>(null);
  readonly hasMore = signal(false);

  ngOnInit(): void {
    this.loadEntries(null);
  }

  loadEntries(parentId: string | null): void {
    this.loading.set(true);
    this.error.set(null);

    this.entryService
      .getEntries({ parentId: parentId, cursor: null, limit: 50 })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (response) => {
          this.entries.set(response.items);
          this.nextCursor.set(response.page.nextCursor);
          this.hasMore.set(response.page.hasMore);
        },
        error: (error: HttpErrorResponse) => {
          this.error.set(this.getErrorMessage(error));
        },
      });
  }

  private getErrorMessage(error: HttpErrorResponse): string {
    switch (error.status) {
      case 0:
        return 'Backend nije dostupan.';
      case 400:
        return 'Zahtjev nije ispravan.';
      case 403:
        return 'Nemaš dopuštenje za ovaj sadržaj.';
      case 404:
        return 'Mapa ne postoji.';
      default:
        return 'Datoteke se trenutno ne mogu učitati.';
    }
  }

  retry() {
    this.loadEntries(null);
  }

  showMenu(selected: Folder | File) {}
}
