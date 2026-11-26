---
name: worker-reliability-patterns
description: >-
  Use when modifying background workers, job processors, queue repositories,
  streaming archivers, or shutdown handling in backend/src/workers/,
  backend/src/folder/download/, backend/src/object-deletion/, or upload/sharing
  cleanup services.
---

# Worker Reliability Patterns

Follow this checklist whenever changing background workers or queue processors.

## Required Invariants

1. **Claiming & Concurrency**
   - Claim work with `FOR UPDATE SKIP LOCKED` inside a short transaction.
   - Always increment `attempt_count` on claim and guard completions/failures/renewals with `(id, attempt_count, active_status)` so stale workers cannot overwrite newer attempts.
2. **Lease Renewal & Cancellation**
   - Long-running jobs (especially `FolderDownloadProcessor`) must periodically call `renewLease()` on an interval shorter than `LEASE_DURATION_MS` (e.g., `LEASE_DURATION_MS / 3`).
   - Wire an `AbortController` to lease renewal failure and worker shutdown so work stops immediately if the lease is lost.
3. **Bounded Retries**
   - Enforce an explicit `maxAttempts` cap on queued jobs so poison-pill items transition to a terminal failed state instead of looping forever.
4. **Resource & Stream Cleanup**
   - In streaming pipelines (`StreamingFolderArchiver`), always destroy active S3 read streams, `PassThrough` streams, and archiver instances in error/abort paths, and listen for both `error` and `close` so Promises never hang.
5. **Polling & Graceful Shutdown**
   - Prefer an async loop with work draining and idle backoff over 1-second `node-cron` polling on empty tables.
   - Handle `SIGTERM` and `SIGINT`: stop claiming new jobs, wait for the active job to finish or abort cleanly, then call `closeDatabase()`.

## Verification

1. Add unit tests covering: lease loss / stale completion, `maxAttempts` terminal failure, stream error cleanup, and shutdown behavior.
2. Run: `cd backend && npm run check && npm run typecheck:test && npm run test:unit` (and `npm run test:integration` if repository SQL changed).
3. Commit worker changes and their tests in a small, self-contained commit.
