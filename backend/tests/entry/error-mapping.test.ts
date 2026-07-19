import { DrizzleQueryError } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { decodeCursor } from '../../src/entry/entry-list-cursor.js';
import { mapEntryDatabaseError } from '../../src/entry/map-entry-db-error.js';
import { AppError } from '../../src/shared/errors/api/app-error.js';

const CONSTRAINT = 'entries_owner_parent_name_active_key';

describe('entry error mapping', () => {
  it('preserves the database cause when mapping duplicate_entry_name', () => {
    const postgresError = Object.assign(new Error('Unique violation'), {
      code: '23505',
      constraint: CONSTRAINT,
    });
    const drizzleError = new DrizzleQueryError('insert into entries', [], postgresError);

    expect(mapEntryDatabaseError(drizzleError)).toMatchObject({
      code: 'duplicate_entry_name',
      options: {
        cause: drizzleError,
        context: {
          constraint: CONSTRAINT,
        },
      },
    });
  });

  it('preserves unexpected Error instances', () => {
    const error = new Error('Database unavailable');

    expect(mapEntryDatabaseError(error)).toBe(error);
  });

  it('keeps the parse cause and safe context for an invalid cursor', () => {
    try {
      decodeCursor('not-json');
      throw new Error('Expected decodeCursor to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      if (!(error instanceof AppError)) return;

      expect(error).toMatchObject({
        code: 'invalid_cursor',
        options: {
          context: {
            cursorLength: 8,
          },
        },
      });
      expect(error.options.cause).toBeInstanceOf(Error);
    }
  });
});
