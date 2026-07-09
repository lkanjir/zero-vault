type PostgresError = {
  code?: string;
  constraint?: string;
};

export function isUniqueViolation(error: unknown, constraintName: string): boolean {
  if (!isPostgresError(error)) {
    return false;
  }

  return error.code === '23505' && error.constraint === constraintName;
}

function isPostgresError(error: unknown): error is PostgresError {
  return typeof error === 'object' && error !== null && 'code' in error;
}
