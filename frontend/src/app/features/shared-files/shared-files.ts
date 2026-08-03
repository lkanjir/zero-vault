import {
  AfterViewInit,
  Component,
  DestroyRef,
  inject,
  OnInit,
  TrackByFunction,
  viewChild,
} from '@angular/core';
import { SharedFileStore } from './state/shared-files-store';
import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import { SharedFile } from '../../data-access/sharing/sharing-models';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { Icon } from '../../shared/icon/icon';
import { FileSizePipe } from '../../shared/pipes/file-size-pipe';

const LOAD_MORE_THRESHOLD = 10;

@Component({
  selector: 'app-shared-files',
  imports: [ScrollingModule, DatePipe, Icon, FileSizePipe],
  templateUrl: './shared-files.html',
})
export class SharedFiles implements OnInit, AfterViewInit {
  readonly store = inject(SharedFileStore);
  readonly destroyRef = inject(DestroyRef);
  readonly viewport = viewChild(CdkVirtualScrollViewport);

  readonly trackFile: TrackByFunction<SharedFile> = (_index, file) => file.id;

  ngOnInit(): void {
    this.store.load();
  }

  ngAfterViewInit(): void {
    const viewport = this.viewport();
    if (!viewport) {
      return;
    }

    viewport.renderedRangeStream.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(({ end }) => {
      const loadedCount = this.store.files().length;

      if (loadedCount > 0 && loadedCount - end <= LOAD_MORE_THRESHOLD) {
        this.store.loadMore();
      }
    });
  }

  retry(): void {
    this.store.retry();
  }

  retryLoadMore(): void {
    this.store.retryLoadMore();
  }
}
