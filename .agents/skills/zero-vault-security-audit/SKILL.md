---
name: zero-vault-security-audit
description: >-
  Use when implementing security hardening phases (S1-S4), reviewing new API
  endpoints, or auditing auth, authorization, rate limiting, S3 presigning, CSP,
  Keycloak, or Docker deployment configs in Zero Vault.
---

# Zero Vault Security Review Checklist

Apply this checklist when implementing security improvements or reviewing sensitive changes.

## 1. Authentication & Keycloak
- JWT verification (`access-token-verifier.ts`): enforce `issuer`, `audience`, `RS256`, `typ` claim, required claims (`sub`, `iat`, `exp`), verified email, and bounded JWKS fetch timeouts.
- Keycloak realm (`keycloak/realm/zero-vault-realm.json`): `revokeRefreshToken: true`, `refreshTokenMaxReuse: 0`, strict brute-force `failureFactor` (5-10), `pkce.code.challenge.method: S256`, no unnecessary `offline_access` on SPA client.
- Frontend interceptor (`auth-interceptor.ts`): attach `Authorization` strictly for `/api` and `/api/...` paths.

## 2. Authorization & Data Leakage
- Check for TOCTOU gaps between authorization, resource lookup, and audit logging.
- Verify soft-deleted resources (`entries.deleted_at IS NULL`) and inactive users (`users.deleted_at IS NULL`) cannot be downloaded, listed, or accessed via stale download jobs.
- Avoid exposing raw internal sequential DB IDs in unsigned pagination cursors (use HMAC-signed/encrypted cursors or `publicId` tie-breakers).
- Ensure `Cache-Control: no-store` is set on `/api/*` responses.

## 3. Rate Limiting & DoS Bounds
- Configure `trust proxy` explicitly for reverse-proxy deployments.
- Use a shared Redis store for multi-instance API deployments.
- Apply both unauthenticated IP-based rate limits before `/api` and authenticated per-principal limits on expensive endpoints (listings, search, audit, mutations, uploads, downloads).
- Enforce storage quotas, max pending upload intents per user, max ZIP file count/total size, and max folder tree depth in recursive CTEs and create/move operations.

## 4. Storage, CSP & Deployment
- Validate `Content-Type` with a strict media-type pattern and sanitize `Content-Disposition` (ASCII fallback + RFC 5987 `filename*`, no control characters).
- Keep strict nonce-based CSP and Angular Trusted Types; prefer self-hosted fonts over third-party CDNs.
- In `compose.deploy.yaml`: isolate `app-db` (and Redis) on internal networks only, separate migration DB role from least-privilege runtime DB role, set `read_only: true`, `cap_drop: [ALL]`, `no-new-privileges:true`, resource limits, and redact secrets in structured logs.

## Verification

Run targeted security tests (unit + integration) alongside `npm run check`, and commit each security hardening step with regression tests.
