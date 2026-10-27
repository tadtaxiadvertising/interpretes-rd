# Architecture Specification — Free Interpreters OS v3

> **Architecture**: Unified Data Layer (Direct Prisma) + Decoupled REST for Clients
> **Runtime**: Easypanel (Docker/VPS) — Self-Hosted
> **Auth**: Supabase Auth (native, with RLS)
> **Framework**: Next.js 15.2.6 (Monorepo deployment)
> **Last Updated**: 2026-10-01

---

## 1. Technology Stack

| Layer       | Technology                            | Version  | Service           | Rationale                                    |
| :---------- | :------------------------------------ | :------- | :---------------- | :------------------------------------------- |
| Framework   | Next.js (App Router)                  | 15.2.6   | Both              | SSR/SSG + API Routes + Server Actions        |
| Runtime     | React                                 | 19.0.0   | Both              | Concurrent features, Server Components       |
| Auth        | Supabase Auth                         | 2.105.1  | Frontend (SSR)    | Native auth, RLS integration, free tier      |
| Database    | Supabase PostgreSQL                   | —        | Backend only      | Managed Postgres, connection pooling         |
| ORM         | Prisma + `@prisma/adapter-pg`         | 7.8.0    | Backend only      | Type-safe queries, ESM support, pg adapter   |
| Validation  | Zod                                   | 4.4.3    | Both              | Runtime + compile-time type safety           |
| Styling     | Tailwind CSS + Lucide Icons           | v4       | Frontend only     | Utility-first, tree-shakeable                |
| Deployment  | Easypanel (Docker on VPS)             | —        | Both              | Self-hosted, webhook-driven CI/CD            |

## 2. Service Architecture

### 2.1 Service Boundary

| Service              | Repository (Current)    | Easypanel App        | Port | Build Target     | Responsibility                               |
| :------------------- | :---------------------- | :------------------- | :--- | :--------------- | :------------------------------------------- |
| **interpreters-os**  | `free-interpreters-os`  | `interpreters`       | 3000 | `Dockerfile`     | UI, Legacy Auth (Supabase), Direct DB        |
| **portal-rbac**      | `free-interpreters-os`  | `interpreters`       | 3000 | `Dockerfile`     | Secure Vault UI, RBAC Auth (Auth.js)         |
| **interpreters-api** | `free-interpreters-os`  | `interpreters-api`   | 4000 | `Dockerfile.api` | External REST, webhooks, legacy modules      |

> **Dual-Authentication Architecture**: The platform uses two authentication systems in parallel:
>
> 1. **Supabase Auth**: Managed auth for the main interpreter roster, onboarding, and dashboard.
> 2. **Auth.js (NextAuth v5)**: Dedicated, session-based auth for the **Portal RBAC** (`/portal-rbac/*`), providing strict role-based access for Admin, Holders, and Interpreters.

### 2.2 Communication Flow

```text
┌──────────────┐   Direct Logic     ┌──────────────────┐   TCP/pgBouncer   ┌──────────────┐
│  Browser      │ ──────────────── → │  interpreters-os  │                   │              │
│  (User)       │ ← ──────────────── │  (Server Actions) │                   │              │
└──────────────┘   HTML/JSON         └────────┬─────────┘                   │              │
                                              │                             │   Supabase   │
                                     Internal │  Prisma Client              │   PostgreSQL │
                                     (No DNS) ▼                             │              │
                                     ┌──────────────────┐   Prisma/pg      │              │
                                     │  interpreters-api │ ───────────────→ │              │
                                     │  (External REST)  │                  │              │
                                     └──────────────────┘                   └──────────────┘
```

- **Frontend → Backend**: Server-side logic consumes Prisma directly via `src/lib/prisma.ts`.
- **Portal RBAC**: Protected by `lib/auth-rbac.ts`. Uses `RbacUser` model for local authentication.
- **Client → Backend**: Client-side interactivity uses Server Actions (`src/app/actions/*`).
- **Auth Verification**: Middleware (`src/middleware.ts`) detects the route and verifies the corresponding session (Supabase or Auth.js).

### 2.3 Database Connection Strategy

```text
┌─────────────────┐   Transaction Pool (port 6543)   ┌──────────────┐
│ interpreters-api │ ──────────────────────────────→  │  Supabase    │
│ (Runtime)        │   DATABASE_URL + pgBouncer       │  Pooler      │
└─────────────────┘                                   └──────────────┘

┌─────────────────┐   Direct Session (port 5432)      ┌──────────────┐
│ prisma migrate   │ ──────────────────────────────→  │  Supabase    │
│ (CI/CD only)     │   DIRECT_URL                     │  Direct DB   │
└─────────────────┘                                   └──────────────┘
```

> **Memory Constraint**: The Easypanel VPS allocates ~457 MB to the API container. The `pg.Pool` is configured with `max: 5` connections and `connectionTimeoutMillis: 10000` to stay within budget. Always use port **6543** (transaction pooler) for `DATABASE_URL` in production.

## 3. Breaking Changes Log (Next.js 15.2.6)

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

As documented in the Next.js 15 specifications and verified by our deployment logs, the `middleware.ts` convention is deprecated.

- **Current State**: `src/middleware.ts` handles **only** Supabase Auth session refreshing.
- **Future State**: All interceptor logic should move to the **Proxy** layer.
- **Rewrites**: All API forwarding and URL masking must reside in `next.config.ts` `rewrites()`. This ensures the standalone build routes traffic correctly through the Node.js server.

### 3.3 Configuration Surface

`outputFileTracingIncludes` has been promoted from `experimental` to a top-level property in `next.config.ts`. The `serverExternalPackages` property replaces `experimental.serverComponentsExternalPackages`.

## 4. Authentication & Authorization (Supabase RBAC)

### Roles

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

> **Note**: The middleware gracefully degrades if `NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` are missing at runtime — it logs a warning and passes the request through instead of crashing the container with a 502.

### API Auth Flow (Backend)

```text
Request → CORS Check → Bearer Token Extraction → Supabase Token Verify → Route Handler
```

## 5. Caching Strategy

| Data Type        | Strategy          | TTL  | Invalidation                   |
| :--------------- | :---------------- | :--- | :----------------------------- |
| Interpreter List | ISR               | 60s  | `revalidatePath()` on mutation |
| Dashboard Stats  | ISR               | 120s | Time-based                     |
| QA Scores        | On-demand         | 0    | Always fresh                   |
| Payroll Records  | On-demand         | 0    | Always fresh (financial)       |
| System Config    | Server-side cache | 300s | Manual revalidation            |

## 6. Map of Services

1. **Interpreter Hub**: Master roster CRUD (Backend API).
2. **Production Telemetry**: CSV import + real-time call tracking (Backend API).
3. **QA Service**: Weighted evaluation forms with auto-fail logic (Backend API).
4. **Payroll Engine**: DB-side aggregation → transactional record creation (Backend API).
5. **Recruitment Pipeline**: Webhook-driven state machine for candidates (Backend API).
6. **Notification Service**: User-scoped alerts with read/unread state (Backend API).
7. **Frontend Shell**: SSR pages, auth sessions, UI components (Frontend).
