# Backend Agent Guidelines

## Layer Boundaries

- **Routes (`*-routes.ts`)**: Parse/validate HTTP input (`validateRequest`), apply route-level middleware (rate limits, auth/user resolution), delegate to a service, and format HTTP status/headers/body. Do not put business logic, SQL, or manual `userService.resolveUser` boilerplate inside individual route handlers.
- **Services (`*-service.ts`)**: Own business rules, authorization decisions, transaction orchestration (`UnitOfWork`), audit event recording, and DTO mapping.
- **Repositories (`postgres-*-repository.ts`)**: Pure persistence and SQL queries. Accept `db` or a transaction handle via constructor/parameter instead of importing a global `db` singleton. Do not duplicate authorization checks across both service and repository layers.

## Configuration, DI, and Lifecycle

- Avoid import-time side effects in configuration modules (`config.ts`) and avoid forcing migrations or workers to require unrelated env vars (e.g., `migrate` and `maintenance-worker` must not require S3 or OIDC settings).
- Each runtime entrypoint (`server.ts` and each worker under `src/workers/`) must use its own minimal composition root and handle `SIGTERM` / `SIGINT` with graceful shutdown (drain in-flight work, close HTTP server, close DB pool).
- Centralize cross-cutting error mapping (such as `StorageError` to `AppError`) in the HTTP error handler instead of duplicating `try/catch` blocks across services.

## Database & Migrations

- Keep `src/db/schema.ts` strictly synchronized with `drizzle/*.sql` migrations — including partial unique indexes, CHECK constraints, and composite foreign keys.
- Any name validation rule (files, folders, uploads) must stay aligned with archive path safety (disallow `/`, `\`, `.`, `..`, and ASCII control characters).
- Always run `npm run test:integration` after touching schemas, migrations, SQL queries, or transaction/locking behavior.

## Security Defaults

- Never log raw credentials, `Authorization` headers, cookies, or presigned URL signatures.
- Set `Cache-Control: no-store` on API responses containing user data or presigned URLs.
- Validate all inputs with Zod before business logic and enforce explicit depth/size/count bounds on recursive queries and background jobs.

## Stack Version Conventions

- **Express 5**: Async route handlers and middleware reject natively to `errorHandler` (no `express-async-errors` wrapper needed); wildcard catch-all routes use `/{*path}` syntax.
- **Zod 4**: Use top-level string/format schemas (`z.url()`, `z.uuid()`, `z.email()`, `z.stringbool()`, `z.iso.datetime()`), `z.prettifyError()`, and `{ error: '...' }` instead of legacy Zod 3 `{ message: '...' }`.
- **Drizzle ORM 0.45 / PostgreSQL 18**: Keep `src/db/schema.ts` aligned with `drizzle/*.sql` (note `uniqueIndex` in 0.45 does not support `.nullsNotDistinct()`, so partial `NULLS NOT DISTINCT` unique indexes stay documented custom migrations); use `date_trunc('milliseconds', col, 'UTC')` when an `IMMUTABLE` index expression is required.
- **Vitest 4 + `vitest-mock-extended`**: Use `mock<T>()` for isolated unit tests and Testcontainers (`tests/integration/`) for PostgreSQL/LocalStack verification.
