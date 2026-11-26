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
