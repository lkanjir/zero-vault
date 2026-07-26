import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '../db/db-client.js';
import { objectDeletionJobs } from '../db/schema.js';
import type { ObjectDeletionJob } from './object-deletion-job.js';
import type {
  ClaimNextObjectDeletionCommand,
  CompleteObjectDeletionCommand,
  ObjectDeletionRepository,
  RescheduleObjectDeletionCommand,
} from './object-deletion-repository.js';

export class PostgresObjectDeletionRepository implements ObjectDeletionRepository {
  async claimNext(command: ClaimNextObjectDeletionCommand): Promise<ObjectDeletionJob | null> {
    const result = await db.transaction(async (tx) => {
      const [claimedRow] = await tx
        .select()
        .from(objectDeletionJobs)
        .where(
          and(
            isNull(objectDeletionJobs.completedAt),
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

      const [updatedRow] = claimedRow
        ? await tx
            .update(objectDeletionJobs)
            .set({
              leaseExpiresAt: command.leaseExpiresAt,
              attemptCount: sql`${objectDeletionJobs.attemptCount} + 1`,
            })
            .where(eq(objectDeletionJobs.id, claimedRow.id))
            .returning()
        : [null];

      return updatedRow;
    });

    return result ? this.toDomain(result) : null;
  }

  complete(command: CompleteObjectDeletionCommand): Promise<boolean> {
    throw new Error('Method not implemented.');
  }

  reschedule(command: RescheduleObjectDeletionCommand): Promise<boolean> {
    throw new Error('Method not implemented.');
  }

  private toDomain(updatedRow: typeof objectDeletionJobs.$inferSelect): ObjectDeletionJob {
    return {
      id: updatedRow.id,
      objectKey: updatedRow.objectKey,
      reason: updatedRow.reason,
      createdAt: updatedRow.createdAt,
      availableAt: updatedRow.availableAt,
      attemptCount: updatedRow.attemptCount,
      leaseExpiresAt: updatedRow.leaseExpiresAt,
      completedAt: updatedRow.completedAt,
      lastErrorCode: updatedRow.lastErrorCode,
    };
  }
}
