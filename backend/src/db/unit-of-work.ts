import type { Database, Transaction } from './db-client.js';

declare const transactionBrand: unique symbol;

export type TransactionContext = {
  readonly [transactionBrand]: 'TransactionContext';
};

export type DbExecutor = Database | Transaction;

export interface UnitOfWork {
  run<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T>;
}

const transactionContexts = new WeakMap<TransactionContext, Transaction>();

export function toTransactionContext(tx: Transaction): TransactionContext {
  const context = Object.freeze({}) as TransactionContext;
  transactionContexts.set(context, tx);
  return context;
}

export function requireTransaction(tx: TransactionContext): Transaction {
  const resolved = transactionContexts.get(tx);

  if (!resolved) {
    throw new Error('Invalid or unmanaged transaction context');
  }

  return resolved;
}

export function resolveDbExecutor(db: Database, tx?: TransactionContext): DbExecutor {
  return tx === undefined ? db : requireTransaction(tx);
}

export class DrizzleUnitOfWork implements UnitOfWork {
  constructor(private readonly db: Database) {}

  run<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => work(toTransactionContext(tx)));
  }
}
