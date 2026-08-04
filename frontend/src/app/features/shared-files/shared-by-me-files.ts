import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import { DatePipe } from '@angular/common';
import {
  AfterViewInit,
  Component,
  DestroyRef,
  inject,
  OnInit,
  TrackByFunction,
  viewChild,
} from '@angular/core';
import { Icon } from '../../shared/icon/icon';
import { FileSizePipe } from '../../shared/pipes/file-size-pipe';
import { SharedByMeStore } from './state/shared-by-me-store';
import { SharedByMeFile } from '../../data-access/sharing/sharing-models';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

const LOAD_MORE_THRESHOLD = 10;

@Component({
  selector: 'app-shared-by-me-files',
  imports: [ScrollingModule, DatePipe, Icon, FileSizePipe],
  templateUrl: './shared-by-me-files.html',
})
export class SharedByMeFiles implements OnInit, AfterViewInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly viewport = viewChild(CdkVirtualScrollViewport);

  readonly store = inject(SharedByMeStore);
  readonly trackFile: TrackByFunction<SharedByMeFile> = (_index, file) => file.id;

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
