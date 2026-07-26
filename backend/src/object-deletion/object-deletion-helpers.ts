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
  const insertedCount = await enqueueObjectDeletionsInTransaction(tx, [command]);
  return insertedCount === 1;
}

export async function enqueueObjectDeletionsInTransaction(
  tx: Transaction,
  commands: readonly EnqueueObjectDeletionCommand[],
): Promise<number> {
  if (commands.length === 0) {
    return 0;
  }

  const inserted = await tx
    .insert(objectDeletionJobs)
    .values(commands.map((command) => ({ objectKey: command.objectKey, reason: command.reason })))
    .onConflictDoNothing({ target: objectDeletionJobs.objectKey })
    .returning({ id: objectDeletionJobs.id });

  return inserted.length;
}
