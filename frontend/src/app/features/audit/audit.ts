import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import { DatePipe } from '@angular/common';
import {
  AfterViewInit,
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  TrackByFunction,
  viewChild,
} from '@angular/core';
import { Icon } from '../../shared/icon/icon';
import { debounceTime, distinctUntilChanged, map, Subject } from 'rxjs';
import { AuditStore } from './state/audit-store';
import { AuditEvent } from '../../data-access/audit/audit-model';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AUDIT_ACTION_LABELS } from './audit-action-labels';

const LOAD_MORE_THRESHOLD = 10;

@Component({
  selector: 'app-audit',
  imports: [ScrollingModule, DatePipe, Icon],
  templateUrl: './audit.html',
  host: {
    class: 'block h-full min-h-0',
  },
})
export class Audit implements OnInit, AfterViewInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly searchInput = new Subject<string>();

  readonly store = inject(AuditStore);
  readonly viewport = viewChild(CdkVirtualScrollViewport);
  readonly auditActionLabels = AUDIT_ACTION_LABELS;

  readonly trackEvent: TrackByFunction<AuditEvent> = (_index, event) => event.id;

  readonly emptyMessage = computed(() => {
    const search = this.store.search();

    return search === null ? 'Nema zabilježenih aktivnosti.' : `Nema rezultata za "${search}".`;
  });

  constructor() {
    this.searchInput
      .pipe(
        map((value) => value.trim()),
        debounceTime(300),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((search) => {
        this.viewport()?.scrollToIndex(0);
        this.store.setSearch(search);
      });
  }

  ngOnInit(): void {
    this.store.load();
  }

  ngAfterViewInit(): void {
    const viewport = this.viewport();

    if (!viewport) {
      return;
    }

    viewport.renderedRangeStream.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(({ end }) => {
      const loadedCount = this.store.events().length;

      if (loadedCount > 0 && loadedCount - end <= LOAD_MORE_THRESHOLD) {
        this.store.loadMore();
      }
    });
  }

  onSearchInput(value: string): void {
    this.searchInput.next(value);
  }

  retryEvents(): void {
    this.store.retryEvents();
  }

  retryStatistics(): void {
    this.store.retryStatistics();
  }

  retryLoadMore(): void {
    this.store.retryLoadMore();
  }
}
