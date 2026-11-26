---
name: backend-layer-refactoring
description: >-
  Use when refactoring or adding backend features across routes, services,
  repositories, UnitOfWork transactions, authorization, audit logging, or
  composition roots in backend/src/.
---

# Backend Layer Refactoring Workflow

Follow this procedure when restructuring or adding backend modules in `backend/src/`.

## Target Layering

1. **HTTP Layer (`*-routes.ts`, `shared/http/`)**
   - Validate `params`, `query`, and `body` with `validateRequest`.
   - Rely on shared middleware for JWT verification (`requireAuth`), user resolution (`req.user`), and rate limiting.
   - Delegate directly to a service method and return the mapped HTTP status/headers/body.
2. **Application / Service Layer (`*-service.ts`)**
   - Own transaction boundaries via a `UnitOfWork` / transaction runner.
   - Perform authorization (`AuthorizationService` / locked-row authz) once per operation — never authorize outside a transaction and then re-authorize the same entity inside the repository.
   - Record audit events in the same transaction as the state mutation they describe.
   - Let `StorageError` bubble up to the centralized error handler unless a domain-specific translation (like `StorageObjectNotFoundError -> upload_object_missing`) is required.
3. **Persistence Layer (`postgres-*-repository.ts`)**
   - Inject `db` (or pass `tx`) explicitly; do not import a global `db` singleton.
   - Keep repository methods focused on SQL, row locking (`FOR UPDATE`, `FOR KEY SHARE`, `SKIP LOCKED`), and Postgres error mapping.
4. **Composition Roots**
   - Wire only the dependencies needed by each entrypoint (`api`, `folder-download-worker`, `object-deletion-worker`, `maintenance-worker`).

## Execution & Commit Steps

1. Identify one small, vertical slice (e.g., one module or one cross-cutting refactor).
2. Update implementation and corresponding unit/integration tests together.
3. Run verification:
   - `cd backend && npm run check && npm run typecheck:test && npm run test:unit`
   - Run `npm run test:integration` if any SQL, locking, or transaction behavior changed.
4. Commit that single slice before starting the next slice.
