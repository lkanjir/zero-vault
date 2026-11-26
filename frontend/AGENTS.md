# Frontend Agent Guidelines

## Runtime Configuration & Auth

- Never hardcode production OIDC/auth URLs in `src/environments/environment.ts` when runtime configuration is used; keep builds environment-agnostic.
- Restrict the auth HTTP interceptor strictly to same-origin API paths (`request.url === '/api' || request.url.startsWith('/api/')`) so bearer tokens can never leak to third-party or storage URLs.
- Handle token refresh failures explicitly (redirect/re-authenticate rather than leaving the app in a broken error state).

## State, RxJS & UX Reliability

- Always bound polling streams (e.g., folder archive status) with a maximum duration/retry limit, respect server `Retry-After` headers when present, and cancel active streams on navigation or component destroy.
- Keep Angular Trusted Types and nonce-based CSP compatibility intact: avoid inline event handlers, raw `innerHTML`, or external font/script origins unless explicitly approved.
- Keep user-facing UI text in Croatian and code identifiers in English.
