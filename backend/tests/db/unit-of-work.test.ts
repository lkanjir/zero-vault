import { describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type { Database, Transaction } from '../../src/db/db-client.js';
import { DrizzleUnitOfWork, type TransactionContext } from '../../src/db/unit-of-work.js';

describe('DrizzleUnitOfWork', () => {
  it('opens a Drizzle transaction and passes the transaction directly to the callback', async () => {
    const drizzleTx = mock<Transaction>();
    const db = mock<Database>();
    db.transaction.mockImplementation((callback) => callback(drizzleTx));

    const unitOfWork = new DrizzleUnitOfWork(db);

    const result = await unitOfWork.run((tx) => {
      expect(tx).toBe(drizzleTx);
      return Promise.resolve('committed');
    });

    expect(result).toBe('committed');
    expect(db.transaction).toHaveBeenCalledOnce();
  });

  it('propagates errors thrown inside the transaction callback', async () => {
    const drizzleTx = mock<Transaction>();
    const db = mock<Database>();
    db.transaction.mockImplementation((callback) => callback(drizzleTx));

    const unitOfWork = new DrizzleUnitOfWork(db);
    const error = new Error('boom');
    const work = vi.fn<(tx: TransactionContext) => Promise<void>>().mockRejectedValue(error);

    await expect(unitOfWork.run(work)).rejects.toBe(error);
    expect(work).toHaveBeenCalledExactlyOnceWith(drizzleTx);
  });
});
