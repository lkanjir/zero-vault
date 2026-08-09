import type { AuthorizationService } from '../authorization/authorization-service.js';
import { AppError } from '../shared/errors/api/app-error.js';
import type { User } from '../user/user.js';
import {
  decodeAuditEventListCursor,
  encodeAuditEventListCursor,
} from './audit-event-list-cursor.js';
import type { AuditEventRecord, AuditRepository } from './audit-repository.js';
import type { AuditEventListResponse, AuditEventResponse, AuditStatisticsResponse } from './dto.js';
import type { ListAuditEventsRequest } from './validation-schemas.js';

const AUDIT_STATISTICS_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

export class AuditService {
  constructor(
    private readonly authzService: AuthorizationService,
    private readonly auditRepository: AuditRepository,
  ) {}

  async listEvents(user: User, request: ListAuditEventsRequest): Promise<AuditEventListResponse> {
    this.authorizeRead(user);

    const cursor = request.cursor === null ? null : decodeAuditEventListCursor(request.cursor);

    if (cursor !== null && cursor.search !== request.search) {
      throw new AppError('invalid_cursor');
    }

    const records = await this.auditRepository.listEvents({
      ownerId: user.id,
      search: request.search,
      cursor:
        cursor === null
          ? null
          : { occurredAt: new Date(cursor.occurredAt), auditEventId: cursor.auditEventId },
      limit: request.limit + 1,
    });

    const pageRecords = records.slice(0, request.limit);
    const hasMore = records.length > request.limit;
    const lastRecord = pageRecords.at(-1);

    const nextCursor =
      hasMore && lastRecord
        ? encodeAuditEventListCursor({
            v: 1,
            search: request.search,
            occurredAt: lastRecord.cursor.occurredAt.toISOString(),
            auditEventId: lastRecord.cursor.auditEventId,
          })
        : null;

    return {
      items: pageRecords.map((record) => this.toResponse(record)),
      page: {
        limit: request.limit,
        hasMore,
        nextCursor,
      },
    };
  }

  async getStatistics(user: User): Promise<AuditStatisticsResponse> {
    this.authorizeRead(user);

    const to = new Date();
    const from = new Date(to.getTime() - AUDIT_STATISTICS_PERIOD_MS);

    const statistics = await this.auditRepository.getStatistics({ ownerId: user.id, from, to });

    return {
      period: {
        from: from.toISOString(),
        to: to.toISOString(),
      },
      total: statistics.total,
      entryChanges: statistics.entryChanges,
      downloadRequests: statistics.downloadRequests,
      sharingChanges: statistics.sharingChanges,
    };
  }

  private authorizeRead(user: User): void {
    this.authzService.authorizeDriveRoot({
      actorUserId: user.id,
      ownerId: user.id,
      action: 'audit:read',
    });
  }

  private toResponse(record: AuditEventRecord): AuditEventResponse {
    return {
      id: record.id,
      action: record.action,
      occurredAt: record.occurredAt.toISOString(),
      actor: record.actor,
      entry: {
        kind: record.entry.kind,
        name: record.entry.nameSnapshot,
        deleted: record.entry.deletedAt !== null,
      },
      details: record.details,
    };
  }
}
