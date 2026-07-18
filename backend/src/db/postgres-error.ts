import { DrizzleQueryError } from 'drizzle-orm';

type PostgresError = Error & {
  code: string;
  constraint: string | undefined;
};

export function isUniqueViolation(error: unknown, constraintName: string): boolean {
  const postgresError = unwrapPostgresError(error);

  return postgresError?.code === '23505' && postgresError.constraint === constraintName;
}

function unwrapPostgresError(error: unknown): PostgresError | null {
  const candidate = error instanceof DrizzleQueryError ? error.cause : error;
  return isPostgresError(candidate) ? candidate : null;
}

function isPostgresError(error: unknown): error is PostgresError {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    'constraint' in error &&
    (error.constraint === undefined || typeof error.constraint === 'string')
  );
}
