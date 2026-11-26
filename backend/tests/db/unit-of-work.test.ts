import { describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';
import type { Database, Transaction } from '../../src/db/db-client.js';
import {
  DrizzleUnitOfWork,
  requireTransaction,
  resolveDbExecutor,
  toTransactionContext,
  type TransactionContext,
} from '../../src/db/unit-of-work.js';

describe('DrizzleUnitOfWork', () => {
  it('opens a Drizzle transaction and resolves the wrapped transaction context', async () => {
    const drizzleTx = mock<Transaction>();
    const db = mock<Database>();
    db.transaction.mockImplementation((callback) => callback(drizzleTx));

    const unitOfWork = new DrizzleUnitOfWork(db);

    const result = await unitOfWork.run((tx) => {
      expect(requireTransaction(tx)).toBe(drizzleTx);
      expect(resolveDbExecutor(db, tx)).toBe(drizzleTx);
      return Promise.resolve('committed');
    });

    expect(result).toBe('committed');
    expect(db.transaction).toHaveBeenCalledOnce();
  });

  it('falls back to the root database executor when no transaction context is passed', () => {
    const db = mock<Database>();

    expect(resolveDbExecutor(db)).toBe(db);
  });

  it('rejects unmanaged transaction contexts', () => {
    const forgedContext = {} as TransactionContext;

    expect(() => requireTransaction(forgedContext)).toThrow(
      'Invalid or unmanaged transaction context',
    );
  });

  it('propagates errors thrown inside the transaction callback', async () => {
    const drizzleTx = mock<Transaction>();
    const db = mock<Database>();
    db.transaction.mockImplementation((callback) => callback(drizzleTx));

    const unitOfWork = new DrizzleUnitOfWork(db);
    const error = new Error('boom');
    const work = vi.fn<(tx: TransactionContext) => Promise<void>>().mockRejectedValue(error);

    await expect(unitOfWork.run(work)).rejects.toBe(error);
    expect(work).toHaveBeenCalledOnce();
    const [context] = work.mock.lastCall!;
    expect(requireTransaction(context)).toBe(drizzleTx);
  });

  it('wraps an explicit Drizzle transaction in a frozen context token', () => {
    const drizzleTx = mock<Transaction>();
    const context = toTransactionContext(drizzleTx);

    expect(Object.isFrozen(context)).toBe(true);
    expect(requireTransaction(context)).toBe(drizzleTx);
  });
});
