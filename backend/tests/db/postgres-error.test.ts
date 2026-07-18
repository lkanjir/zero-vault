import { DrizzleQueryError } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { isUniqueViolation } from '../../src/db/postgres-error.js';

const CONSTRAINT = 'entries_owner_parent_name_active_key';

describe('isUniqueViolation', () => {
  it('recognizes a PostgreSQL unique constraint violation wrapped by Drizzle', () => {
    const error = makeDrizzleQueryError('23505', CONSTRAINT);

    expect(isUniqueViolation(error, CONSTRAINT)).toBe(true);
  });

  it('recognizes a direct PostgreSQL unique constraint violation', () => {
    const error = makePostgresError('23505', CONSTRAINT);

    expect(isUniqueViolation(error, CONSTRAINT)).toBe(true);
  });

  it('does not map another constraint or PostgreSQL error code', () => {
    expect(isUniqueViolation(makeDrizzleQueryError('23505', 'other_key'), CONSTRAINT)).toBe(false);
    expect(isUniqueViolation(makeDrizzleQueryError('23503', CONSTRAINT), CONSTRAINT)).toBe(false);
  });
});

function makeDrizzleQueryError(code: string, constraint: string): DrizzleQueryError {
  return new DrizzleQueryError(
    'insert into entries (...) values (...)',
    [],
    makePostgresError(code, constraint),
  );
}

function makePostgresError(code: string, constraint: string): Error {
  return Object.assign(new Error('Database error'), {
    code,
    constraint,
  });
}
