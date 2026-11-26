---
name: drizzle-postgres-workflow
description: >-
  Use when modifying PostgreSQL tables, indexes, constraints, or Drizzle ORM
  migrations in backend/src/db/schema.ts and backend/drizzle/.
---

# Drizzle & PostgreSQL Migration Workflow

Use this workflow for any database schema or index change in `backend/`.

## Rules to Preserve

1. **Zero Schema Drift**: Every table, enum, CHECK constraint, foreign key, and partial unique index present in `backend/drizzle/*.sql` must also be represented accurately in `backend/src/db/schema.ts`.
   - **Drizzle 0.45 caveat**: `uniqueIndex(...).on(...)` does not expose `.nullsNotDistinct()`; partial `NULLS NOT DISTINCT` indexes (such as `entries_owner_parent_name_active_key` in `0001_uniqe_index_for_file_name.sql`) must stay documented via comments in `schema.ts`.
   - Offline `drizzle-kit generate` still validates `DATABASE_URL` in `drizzle.config.ts`, so pass a dummy `DATABASE_URL` when generating migrations without a running DB.
2. **Existing Integrity Invariants**: Preserve composite owner-scoped FKs (e.g., `(parent_id, owner_id)`), soft-delete partial indexes (`WHERE deleted_at IS NULL`), and `ON DELETE RESTRICT` rules unless intentionally changing them.
3. **Query-Aligned Indexes**:
   - Check actual `ORDER BY` direction and expressions (`lower(name)`, `date_trunc('milliseconds', updated_at, 'UTC')`, `occurred_at DESC, id DESC`). Note that 3-arg `date_trunc(field, timestamptz, 'UTC')` is `IMMUTABLE` in PostgreSQL, whereas 2-arg `date_trunc(field, timestamptz)` is `STABLE` and rejected in index expressions.
   - For `ILIKE '%term%'` search columns, use `pg_trgm` GIN indexes (`CREATE EXTENSION IF NOT EXISTS pg_trgm;` in the migration) rather than unindexed scans.
4. **Least-Privilege Compatibility**: Keep DDL strictly inside migrations (`backend/drizzle/`); runtime queries must only require DML (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) and sequence `USAGE`.

## Steps

1. Edit `backend/src/db/schema.ts`.
2. Generate or author the migration under `backend/drizzle/` and inspect the generated SQL carefully — never blindly accept unintended `DROP INDEX` or `DROP CONSTRAINT` statements caused by drift.
3. Add or update integration tests in `backend/tests/integration/` covering constraints, index-backed queries, or edge cases.
4. Verify against real PostgreSQL (Testcontainers):
   - `cd backend && npm run check && npm run typecheck:test && npm run test:integration`
5. Commit the schema change, migration files (including `drizzle/meta/`), and tests together as one focused commit.
