import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { AuditApi } from '../../../data-access/audit/audit-api';
import { AuditEvent, AuditStatistics } from '../../../data-access/audit/audit-model';
import { finalize, Subscription } from 'rxjs';
import { apiErrorMessage, toApiError } from '../../../shared/api-error';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

const AUDIT_PAGE_SIZE = 50;

@Injectable()
export class AuditStore {
  private readonly auditApi = inject(AuditApi);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _events = signal<readonly AuditEvent[]>([]);
  private readonly _statistics = signal<AuditStatistics | null>(null);
  private readonly _search = signal<string | null>(null);

  private readonly _eventsLoading = signal(false);
  private readonly _eventsError = signal<string | null>(null);
  private readonly _statisticsLoading = signal(false);
  private readonly _statisticsError = signal<string | null>(null);

  private readonly _nextCursor = signal<string | null>(null);
  private readonly _hasMore = signal(false);
  private readonly _loadingMore = signal(false);
  private readonly _loadMoreError = signal<string | null>(null);

  readonly events = this._events.asReadonly();
  readonly statistics = this._statistics.asReadonly();
  readonly search = this._search.asReadonly();

  readonly eventsLoading = this._eventsLoading.asReadonly();
  readonly eventsError = this._eventsError.asReadonly();
  readonly statisticsLoading = this._statisticsLoading.asReadonly();
  readonly statisticsError = this._statisticsError.asReadonly();

  readonly nextCursor = this._nextCursor.asReadonly();
  readonly hasMore = this._hasMore.asReadonly();
  readonly loadingMore = this._loadingMore.asReadonly();
  readonly loadMoreError = this._loadMoreError.asReadonly();

  private eventsSubscription?: Subscription;
  private statisticsSubscription?: Subscription;
  private loadMoreSubscription?: Subscription;

  load(): void {
    this.loadEvents();
    this.loadStatistics();
  }

  setSearch(value: string): void {
    const search = value.trim() || null;

    if (this._search() === search) {
      return;
    }

    this._search.set(search);
    this.loadEvents();
  }

  retryEvents(): void {
    this.loadEvents();
  }

  retryStatistics(): void {
    this.loadStatistics();
  }

  private loadEvents(): void {
    this.eventsSubscription?.unsubscribe();
    this.loadMoreSubscription?.unsubscribe();

    const search = this._search();

    this._events.set([]);
    this._nextCursor.set(null);
    this._hasMore.set(false);
    this._eventsError.set(null);
    this._loadingMore.set(false);
    this._loadMoreError.set(null);
    this._eventsLoading.set(true);

    this.eventsSubscription = this.auditApi
      .getEvents({
        cursor: null,
        limit: AUDIT_PAGE_SIZE,
        search,
      })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this._eventsLoading.set(false)),
      )
      .subscribe({
        next: (response) => {
          this._events.set(response.items);
          this._nextCursor.set(response.page.nextCursor);
          this._hasMore.set(response.page.hasMore);
        },
        error: (error) => {
          this._eventsError.set(
            apiErrorMessage(toApiError(error), 'Revizijski zapisi trenutno se ne mogu učitati'),
          );
        },
      });
  }

  private loadStatistics(): void {
    this.statisticsSubscription?.unsubscribe();

    this._statistics.set(null);
    this._statisticsError.set(null);
    this._statisticsLoading.set(true);

    this.statisticsSubscription = this.auditApi
      .getStatistics()
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this._statisticsLoading.set(false)),
      )
      .subscribe({
        next: (statistics) => {
          this._statistics.set(statistics);
        },
        error: (error) => {
          this._statisticsError.set(
            apiErrorMessage(toApiError(error), 'Statistika se trenutno ne može učitati.'),
          );
        },
      });
  }

  loadMore(): void {
    if (
      this._eventsLoading() ||
      this._loadingMore() ||
      !this._hasMore() ||
      this._loadMoreError() !== null
    ) {
      return;
    }

    const cursor = this._nextCursor();

    if (cursor === null) {
      return;
    }

    this._loadingMore.set(true);

    this.loadMoreSubscription = this.auditApi
      .getEvents({
        cursor,
        limit: AUDIT_PAGE_SIZE,
        search: this._search(),
      })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this._loadingMore.set(false)),
      )
      .subscribe({
        next: (response) => {
          this._events.update((current) => {
            const existingIds = new Set(current.map((event) => event.id));
            const newEvents = response.items.filter((event) => {
              if (existingIds.has(event.id)) {
                return false;
              }

              existingIds.add(event.id);
              return true;
            });

            return [...current, ...newEvents];
          });

          this._nextCursor.set(response.page.nextCursor);
          this._hasMore.set(response.page.hasMore);
        },
        error: (error) => {
          this._loadMoreError.set(
            apiErrorMessage(
              toApiError(error),
              'Ostali revizijski zapisi trenutno se ne mogu učitati',
            ),
          );
        },
      });
  }

  retryLoadMore(): void {
    this._loadMoreError.set(null);
    this.loadMore();
  }
}
