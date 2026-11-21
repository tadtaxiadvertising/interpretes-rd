# Architecture Specification — Intérpretes RD v3

> **Architecture**: Unified Data Layer (Direct Prisma) + Decoupled REST for Clients
> **Runtime**: Easypanel (Docker/VPS) — Self-Hosted
> **Auth**: Supabase + Auth.js in Next.js; a separate JWT guard in Express (verify each route)
> **Framework**: Next.js 15.5.28 (frontend) + Express 4.22.1 (independent API)
> **Last Updated**: 2026-11-21 (code-level reconciliation; production configuration not independently verified)

---

## 1. Technology Stack

These versions and boundaries reflect the tracked package manifests, not an attestation of what Easypanel currently runs.

| Layer | Technology | Current tracked version | Runtime |
| :-- | :-- | :-- | :-- |
| Web framework | Next.js App Router + React | Next.js 15.5.28 / React 19.0.3 | `interpreters` (`Dockerfile`) |
| REST service | Express + TypeScript | Express 4.22.1 | `interpreters-api` (`Dockerfile.api`) |
| Database | Supabase PostgreSQL via `pg` pools | PostgreSQL managed; `pg` ^8.20.0 | Both services access it directly |
| ORM | Prisma + `@prisma/adapter-pg` | Frontend ^7.10.1; API ^7.8.0 | Both services |
| Validation | Zod | Frontend ^4.6.7; API ^4.4.3 | Both services |
| Browser UI | Tailwind CSS, Lucide | Tailwind v4 | Frontend |
| Production orchestration | Easypanel / Docker | Configured outside GitHub | Verify deployment runtime independently |

## 2. Service Architecture

### 2.1 Service Boundary

| Runtime | Easypanel service name | Internal port | Dockerfile (repository root build context `.`) | Responsibility |
| :-- | :-- | :-- | :-- | :-- |
| Next.js | `interpreters` | 3000 | `Dockerfile` | Web UI, server actions, Next route handlers `src/app/api/`, Supabase and Auth.js sessions, direct Prisma access |
| Express | `interpreters-api` | 3000 | `Dockerfile.api` | Independent REST endpoints from `interpreters-api/src/`, own Prisma pool |
| Optional private audio worker | `roleplay-audio-worker` | No public HTTP port | `Dockerfile.worker` | Serial FFmpeg conversion jobs when enabled, not a public API |

`portal-rbac` is a feature inside the Next.js application, **not** a third standalone application or an additional Easypanel service. The legacy `interpreters-api/Dockerfile` is not the validated root-context build target.

> **Authentication boundary:** Supabase Auth and Auth.js coexist in the Next.js application. They must not be treated as interchangeable authorization systems. Review individual route guards before extending an endpoint; do not infer that a global middleware authenticates every service.

### 2.2 Communication Flow

```text
Browser ── HTTPS ──> Next.js frontend (`interpreters`, port 3000)
                         ├── Server Actions / Next route handlers
                         └── Prisma + pg ──> Supabase PostgreSQL pooler
External REST client ── HTTPS ──> Express API (`interpreters-api`, port 3000)
                                     └── Prisma + pg ──> Supabase PostgreSQL pooler
Optional private Roleplay worker ──> PostgreSQL + Supabase Storage
```

- Next.js server logic uses `src/lib/prisma.ts` directly; it does not require HTTP proxying through the Express API for ordinary internal data access.
- Express mounts routes under `interpreters-api/src/`; the separately built API does **not** serve `src/app/api/`.
- Container ports are independent despite both being 3000. Domain/ingress routing selects the service.
- A successful CI run or deployment webhook does not verify the deployed image or the live database connection.

### 2.3 Database Connection Strategy

`DATABASE_URL` is the runtime connection string for both Next.js and Express. The documented production topology uses the Supabase transaction pooler (typically port 6543), while `DIRECT_URL` is reserved for controlled migrations and schema checks. Never print these values in CI logs or documentation.

The tracked pool configuration currently limits frontend connections to **5** (`src/lib/database-pool-config.ts`, timeout 10 s), and Express connections to **3** (`interpreters-api/src/lib/database-tls.ts`, timeout 5 s). Remote connections require CA-validated TLS; bypassing hostname/certificate verification is not an acceptable workaround.

```text
Next.js      ── DATABASE_URL ──┐
                               ├── Supabase PostgreSQL pooler (runtime)
Express API  ── DATABASE_URL ──┘
Migrations   ── DIRECT_URL ─────── Supabase direct/session connection
```

**Resource caution:** The VPS has historically had a tight memory budget. Actual container limits, Docker build context, healthcheck overrides, DB pooler connectivity, deployed Git SHA, and rollback target must be verified in Easypanel rather than inferred from this repository.

The Express Docker healthcheck queries `GET /health` for process liveness. `GET /ready` checks PostgreSQL separately; failures there may produce 503 without automatically replacing the live HTTP container. The frontend liveness path is `GET /api/health`.

## 3. Next.js 15 Runtime Notes

### 3.1 Async Dynamic Route Parameters

In Next.js 15+, `params` in dynamic API route handlers are delivered as a **Promise**. All `[id]`-style routes must `await params` before accessing fields.

```typescript
// ✅ Required pattern for all dynamic routes
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  const id = parseInt(resolvedParams.id, 10);
  // ...
}
```

### 3.2 Middleware → Proxy Transition

The tracked Next.js version is 15.5.28. The `src/middleware.ts` entry point remains in use; do not assume a migration to the newer `proxy.ts` convention has happened. Review the actual authentication and middleware code before changing route handling or upgrading Next.js.

- **Current State**: `src/middleware.ts` is part of the frontend request pipeline, not the Express process.
- **Upgrade consideration**: Re-evaluate `proxy.ts` and Next.js runtime behavior during a separately tested framework upgrade.
- **Routing**: `next.config.ts` rewrites, if configured, affect Next.js traffic only; they do not turn `Dockerfile.api` into a Next.js image.

### 3.3 Configuration Surface

`outputFileTracingIncludes` has been promoted from `experimental` to a top-level property in `next.config.ts`. The `serverExternalPackages` property replaces `experimental.serverComponentsExternalPackages`.

## 4. Authentication & Authorization

### Roles

The rows below are a high-level inventory, **not** an authorization policy or exhaustive role mapping. Frontend Supabase roles, Auth.js RBAC roles, and Express JWT claims are separate contexts; permissions are established by each route/action and must be reviewed there.

| Role              | Permissions                                           |
| :---------------- | :---------------------------------------------------- |
| admin             | Full CRUD on all modules + payroll approval           |
| qa_auditor        | Read interpreters, CRUD on qa_scores                  |
| payroll_manager   | Read interpreters/logs, manage payroll_records        |
| interpreter       | Read own profile, own logs, own QA scores, call timer |

### Middleware Flow (Frontend)

```text
Request → Supabase Middleware (SSR) → Session Refresh → Page Render
               │
               ├─ Public: /login, /register, /api/health
               ├─ Interpreter: /dashboard/*
               └─ Admin: /admin/*, /payroll/*, /qa/*
```

> **Security note**: The Next.js middleware may skip Supabase session refresh if configuration is unavailable, but its protected-route and API gates still need independent authorization checks. Do **not** treat the presence of an Auth.js cookie as proof of role or scope: handlers and server actions validate current identity and permissions.

### API Auth Flow (Express)

```text
Request → Express CORS / JSON limit → route-specific JWT authGuard (where applied)
        → route-specific authorization → handler → sanitized error handling
```

The Express API's `authGuard` uses a JWT verified with its own configured secret, not the Next.js middleware's Supabase token verification. `/api/auth/login` and `/api/auth/register` are intentionally public; `/api/auth/me` is JWT-protected. Do not assume all Express routes are protected by a global guard; audit each mounted router. The frontend's Next.js `/api/*` path has a separate gate and per-handler permissions.

## 5. Caching Strategy

| Data Type        | Strategy          | TTL  | Invalidation                   |
| :--------------- | :---------------- | :--- | :----------------------------- |
| Interpreter List | ISR               | 60s  | `revalidatePath()` on mutation |
| Dashboard Stats  | ISR               | 120s | Time-based                     |
| QA Scores        | On-demand         | 0    | Always fresh                   |
| Payroll Records  | On-demand         | 0    | Always fresh (financial)       |
| System Config    | Server-side cache | 300s | Manual revalidation            |

## 6. Logical Module Map

This is a domain/function inventory, not a promise that every feature is implemented by the independent Express service. Consult the specific Next.js route handler, server action, or Express router before making changes.

1. **Interpreter Hub**: Master roster CRUD (frontend/API as routed).
2. **Production Telemetry**: CSV import + real-time call tracking (route ownership must be checked).
3. **QA Service**: Weighted evaluation forms with auto-fail logic (route ownership must be checked).
4. **Payroll Engine**: DB-side aggregation → transactional record creation (route ownership must be checked).
5. **Recruitment Pipeline**: Webhook-driven state machine for candidates (route ownership must be checked).
6. **Notification Service**: User-scoped alerts with read/unread state (route ownership must be checked).
7. **Frontend Shell**: SSR pages, auth sessions, UI components (Frontend).
