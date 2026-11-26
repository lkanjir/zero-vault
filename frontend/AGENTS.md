# Frontend Agent Guidelines

## Angular 22 Best Practices (Official CLI Baseline)

- Use standalone components everywhere; do **not** write `standalone: true` inside decorators (default in Angular 20+).
- Do **not** set `changeDetection: ChangeDetectionStrategy.OnPush` explicitly (`OnPush` is the default in Angular 22+).
- Use `inject()` instead of constructor-based dependency injection.
- Use `input()` and `output()` functions instead of `@Input()` / `@Output()` decorators, and put host bindings in the decorator `host` object rather than `@HostBinding` / `@HostListener`.
- Manage local/derived state with signals (`signal()`, `computed()`); update signals with `set()` / `update()` (never `mutate()`).
- Prefer Signal Forms (`@angular/forms/signals`) for new forms; otherwise use Reactive Forms rather than Template-driven forms.
- Prefer `@Service` over `@Injectable({ providedIn: 'root' })` for new singleton services (Angular 22+), keeping existing code consistent when making small edits.
- Use native control flow (`@if`, `@for`, `@switch`) instead of `*ngIf` / `*ngFor` / `*ngSwitch`; use `[class.*]` / `[style.*]` bindings instead of `ngClass` / `ngStyle`; import only needed pipes/directives instead of `CommonModule`.
- Implement lazy loading for feature routes and use `NgOptimizedImage` for static images (not inline base64).
- Maintain WCAG AA accessibility (focus management, contrast, ARIA attributes, AXE-clean markup).
- **Tailwind CSS v4**: CSS-first configuration (`src/styles.css` + `@tailwindcss/postcss`), no `tailwind.config.js`.

## Runtime Configuration & Auth

- Never hardcode production OIDC/auth URLs in `src/environments/environment.ts` when runtime configuration is used; keep builds environment-agnostic.
- Restrict the auth HTTP interceptor strictly to same-origin API paths (`request.url === '/api' || request.url.startsWith('/api/')`) so bearer tokens can never leak to third-party or storage URLs.
- Handle token refresh failures explicitly (redirect/re-authenticate rather than leaving the app in a broken error state).

## State, RxJS & UX Reliability

- Always bound polling streams (e.g., folder archive status) with a maximum duration/retry limit, respect server `Retry-After` headers when present, and cancel active streams on navigation or component destroy.
- Keep Angular Trusted Types and nonce-based CSP compatibility intact: avoid inline event handlers, raw `innerHTML`, or external font/script origins unless explicitly approved.
- Keep user-facing UI text in Croatian and code identifiers in English.
