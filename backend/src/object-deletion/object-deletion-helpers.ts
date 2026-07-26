import type { Transaction } from '../db/db-client.js';
import { objectDeletionJobs } from '../db/schema.js';
import type { ObjectDeletionReason } from './object-deletion-job.js';

export type EnqueueObjectDeletionCommand = {
  objectKey: string;
  reason: ObjectDeletionReason;
};

export async function enqueueObjectDeletionInTransaction(
  tx: Transaction,
  command: EnqueueObjectDeletionCommand,
): Promise<boolean> {
  const [inserted] = await tx
    .insert(objectDeletionJobs)
    .values({
      objectKey: command.objectKey,
      reason: command.reason,
    })
    .onConflictDoNothing({ target: objectDeletionJobs.objectKey })
    .returning({ id: objectDeletionJobs.id });

  return inserted !== undefined;
}
