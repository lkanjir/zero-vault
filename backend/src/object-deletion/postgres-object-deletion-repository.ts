import { and, eq, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { Database } from '../db/db-client.js';
import { objectDeletionJobs } from '../db/schema.js';
import type { ObjectDeletionJob } from './object-deletion-job.js';
import type {
  ClaimNextObjectDeletionCommand,
  CompleteObjectDeletionCommand,
  MarkObjectDeletionFailedCommand,
  ObjectDeletionRepository,
  RescheduleObjectDeletionCommand,
} from './object-deletion-repository.js';

const EXHAUSTED_FAIL_BATCH_SIZE = 100;
const MAX_ATTEMPTS_EXCEEDED_ERROR_CODE = 'max_attempts_exceeded';

export class PostgresObjectDeletionRepository implements ObjectDeletionRepository {
  constructor(private readonly db: Database) {}

  async claimNext(command: ClaimNextObjectDeletionCommand): Promise<ObjectDeletionJob | null> {
    return this.db.transaction(async (tx) => {
      const exhausted = await tx
        .select({ id: objectDeletionJobs.id })
        .from(objectDeletionJobs)
        .where(
          and(
            isNull(objectDeletionJobs.completedAt),
            isNull(objectDeletionJobs.failedAt),
            gte(objectDeletionJobs.attemptCount, command.maxAttempts),
            or(
              isNull(objectDeletionJobs.leaseExpiresAt),
              lte(objectDeletionJobs.leaseExpiresAt, command.claimedAt),
            ),
          ),
        )
        .for('update', { skipLocked: true })
        .limit(EXHAUSTED_FAIL_BATCH_SIZE);

      if (exhausted.length > 0) {
        await tx
          .update(objectDeletionJobs)
          .set({
            failedAt: command.claimedAt,
            leaseExpiresAt: null,
            lastErrorCode: sql`coalesce(${objectDeletionJobs.lastErrorCode}, ${MAX_ATTEMPTS_EXCEEDED_ERROR_CODE})`,
          })
          .where(
            and(
              inArray(
                objectDeletionJobs.id,
                exhausted.map((item) => item.id),
              ),
              isNull(objectDeletionJobs.completedAt),
              isNull(objectDeletionJobs.failedAt),
            ),
          );
      }

      const [candidate] = await tx
        .select({ id: objectDeletionJobs.id })
        .from(objectDeletionJobs)
        .where(
          and(
            isNull(objectDeletionJobs.completedAt),
            isNull(objectDeletionJobs.failedAt),
            lt(objectDeletionJobs.attemptCount, command.maxAttempts),
            lte(objectDeletionJobs.availableAt, command.claimedAt),
            or(
              isNull(objectDeletionJobs.leaseExpiresAt),
              lte(objectDeletionJobs.leaseExpiresAt, command.claimedAt),
            ),
          ),
        )
        .orderBy(objectDeletionJobs.availableAt, objectDeletionJobs.id)
        .for('update', { skipLocked: true })
        .limit(1);

      if (!candidate) {
        return null;
      }

      const [claimed] = await tx
        .update(objectDeletionJobs)
        .set({
          leaseExpiresAt: command.leaseExpiresAt,
          attemptCount: sql`${objectDeletionJobs.attemptCount} + 1`,
        })
        .where(
          and(
            eq(objectDeletionJobs.id, candidate.id),
            isNull(objectDeletionJobs.completedAt),
            isNull(objectDeletionJobs.failedAt),
          ),
        )
        .returning();

      if (!claimed) {
        throw new Error('Failed to claim object deletion job');
      }

      return this.toDomain(claimed);
    });
  }

  async complete(command: CompleteObjectDeletionCommand): Promise<boolean> {
    const [completed] = await this.db
      .update(objectDeletionJobs)
      .set({
        completedAt: command.completedAt,
        leaseExpiresAt: null,
        lastErrorCode: null,
      })
      .where(this.activeAttemptCondition(command.id, command.attemptCount))
      .returning({ id: objectDeletionJobs.id });

    return completed !== undefined;
  }

  async reschedule(command: RescheduleObjectDeletionCommand): Promise<boolean> {
    const [rescheduled] = await this.db
      .update(objectDeletionJobs)
      .set({
        availableAt: command.availableAt,
        leaseExpiresAt: null,
        lastErrorCode: command.errorCode,
      })
      .where(this.activeAttemptCondition(command.id, command.attemptCount))
      .returning({ id: objectDeletionJobs.id });

    return rescheduled !== undefined;
  }

  async markFailed(command: MarkObjectDeletionFailedCommand): Promise<boolean> {
    const [failed] = await this.db
      .update(objectDeletionJobs)
      .set({
        failedAt: command.failedAt,
        leaseExpiresAt: null,
        lastErrorCode: command.errorCode,
      })
      .where(this.activeAttemptCondition(command.id, command.attemptCount))
      .returning({ id: objectDeletionJobs.id });

    return failed !== undefined;
  }

  private activeAttemptCondition(id: number, attemptCount: number) {
    return and(
      eq(objectDeletionJobs.id, id),
      isNull(objectDeletionJobs.completedAt),
      isNull(objectDeletionJobs.failedAt),
      eq(objectDeletionJobs.attemptCount, attemptCount),
    );
  }

  private toDomain(updatedRow: typeof objectDeletionJobs.$inferSelect): ObjectDeletionJob {
    return {
      id: updatedRow.id,
      objectKey: updatedRow.objectKey,
      s3UploadId: updatedRow.s3UploadId,
      reason: updatedRow.reason,
      createdAt: updatedRow.createdAt,
      availableAt: updatedRow.availableAt,
      attemptCount: updatedRow.attemptCount,
      leaseExpiresAt: updatedRow.leaseExpiresAt,
      completedAt: updatedRow.completedAt,
      failedAt: updatedRow.failedAt,
      lastErrorCode: updatedRow.lastErrorCode,
    };
  }
}
