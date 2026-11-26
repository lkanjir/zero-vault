import { vi } from 'vitest';
import type { TransactionContext, UnitOfWork } from '../../src/db/unit-of-work.js';

export function createFakeUnitOfWork() {
  const tx = {} as TransactionContext;
  const unitOfWork: UnitOfWork = {
    run<T>(work: (context: TransactionContext) => Promise<T>): Promise<T> {
      return work(tx);
    },
  };
  const runSpy = vi.spyOn(unitOfWork, 'run');

  return { tx, unitOfWork, runSpy };
}
