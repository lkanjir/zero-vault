# Zero Vault — Agent Guidelines

## Project Overview

- **Backend (`backend/`)**: Node.js + TypeScript + Express 5 + Drizzle ORM + PostgreSQL + S3 + 3 background workers (`folder-download-worker`, `object-deletion-worker`, `maintenance-worker`).
- **Frontend (`frontend/`)**: Angular 22 + Tailwind CSS + `keycloak-js` (PKCE `S256`), served same-origin by the Express backend with per-request CSP nonces and Trusted Types.
- **Auth (`keycloak/`)**: Keycloak 26 realm (`zero-vault`) with `RS256` JWTs.

## Commit Discipline (Mandatory)

- Work in **small, focused commits**. Never bundle an entire multi-step phase or unrelated refactors into one large commit.
- Each commit must represent one coherent, verifiable change **together with its corresponding tests** (unit and/or integration tests updated or added in the same commit).
- Keep the working tree clean and passing checks before creating each commit.
- Use clear, concise imperative commit messages in English (e.g., `refactor(entries): extract shared entry name validation`).

## Language Conventions

- Code identifiers, comments, internal error messages, logs, and commit messages: **English**.
- User-facing API error messages (`backend/src/shared/errors/api/error-catalog.ts`), Zod validation messages shown to users, and Angular UI copy: **Croatian**.

## Verification Commands

Run the relevant checks before committing:

- **Backend**:
  - `cd backend && npm run check` (`typecheck`, `lint`, `format:check`)
  - `cd backend && npm run typecheck:test && npm run test:unit`
  - `cd backend && npm run test:integration` (whenever DB queries, schema, migrations, repositories, or S3 integration change)
- **Frontend**:
  - `cd frontend && npm run typecheck && npm run format:check && npm run build`
  - `cd frontend && npm test` (when tests exist/are modified)

## Architecture & Multi-Instance Invariants

- Design the HTTP API to be **stateless** so multiple API instances can run concurrently behind a reverse proxy (use Redis for shared rate limiting or cross-instance state, never process-local memory for security-critical limits).
- Never hardcode environment-specific URLs or secrets in source files; keep all environment differences configurable at runtime or deployment time.
- Prefer deleting dead/redundant abstractions over keeping unused compatibility layers.
