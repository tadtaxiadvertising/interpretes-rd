<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Heed deprecation notices and follow the established project patterns.

## Pinned Version (Verified by Easypanel success log)

- **Next.js**: `15.2.6` (Strictly Required)
- **React**: `19.0.0` (React 19)
- **Prisma**: `7.8.0` (with `@prisma/adapter-pg`)
- **Tailwind CSS**: `v4`

## Critical Breaking Changes (Next.js 15+)

### 1. Async Dynamic Route Parameters

In Next.js 15+, `params` in dynamic route handlers (`[id]`, `[slug]`, etc.) and layouts are now a **Promise**. You must `await` them before accessing properties.

```typescript
// ✅ CORRECT — Next.js 15.2.6 convention
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  const id = resolvedParams.id;
}
```

### 2. Middleware & Auth Integration

- **Current State**: `src/middleware.ts` handles **both** Supabase Auth session refreshing and Auth.js (NextAuth) session protection for `/portal-rbac`.
- **Logic**: 
  1. `updateSession(req)` from Supabase is called first to refresh cookies.
  2. RBAC protection checks the `next-auth.session-token` (or `__Secure-` variant).
- **Do NOT** move RBAC logic out of middleware unless instructed; it is the current gatekeeper.

### 3. Configuration (Next.js 15+)

`outputFileTracingIncludes` is a top-level config property in `next.config.ts`.

```typescript
// ✅ next.config.ts
const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@prisma/client", "prisma", "@prisma/adapter-pg", "pg"],
  outputFileTracingIncludes: {
    "/": ["./prisma/**/*"],
  },
};
```

## Prisma 7 + pg Adapter (Singleton Pattern)

This project uses `@prisma/adapter-pg` with a raw `pg.Pool` (max 5 connections). 
- **Singleton**: Import `prisma` from `@/lib/prisma`.
- **Pool Management**: Avoid calling `prisma.$disconnect()` or `pool.end()` in standard request flows, as it will break subsequent requests with "Cannot use a pool after calling end".

## Common Troubleshooting (Memory for Agents)

### 1. Auth: UntrustedHost or MissingSecret
- Ensure `AUTH_TRUST_HOST=true` is set (automated in `src/lib/auth-rbac.ts`).
- Ensure `AUTH_SECRET` is defined in Easypanel/Env.
- If using a proxy, verify `NEXTAUTH_URL` matches the public domain.

### 2. Auth: Invalid Credentials (Email Normalization)
- `authorize()` in `src/lib/auth-rbac.ts` normalizes emails with `.toLowerCase().trim()`. 
- When creating users manually via SQL or Seed, ALWAYS store emails in lowercase.

### 3. API Security: Body Consumption
- Use `req.clone()` if you need to read the request body in a wrapper (like `withSecurity`) before passing it to the handler.

### 4. Prisma: Build Failures on CI/CD
- If Prisma fails to validate `DATABASE_URL` during `next build`, ensure the environment variable is available or provided as a dummy during build time.

## Build Output

- Output mode: `standalone`
- Runtime: `node server.js`
- Docker: Multi-stage with `node:22-alpine`

<!-- END:nextjs-agent-rules -->

# LOW-CAPACITY AGENT PRODUCTION PROTOCOL

This section is mandatory for any coding agent working on this repository, especially agents with limited context/reasoning budgets.

## Mission

Do not optimize for lines changed. Optimize for verified correctness, preserved data, predictable state transitions, and a deployable result.

The repository already contains a domain architecture for identity, onboarding, roleplay, QA, metrics, and audio. Reuse it. Do not create parallel systems.

## Hard rule: inspect before edit

Before changing code, the agent MUST inspect:

1. `AGENTS.md` and the relevant package scripts.
2. `prisma/schema.prisma` and the latest relevant migration.
3. The complete target route/service/action and its direct callers.
4. Existing tests for the same behavior.
5. Current branch/commit and CI/deploy status.

Never infer a missing function, Prisma field, route, state, or migration from memory.

## Context-budget strategy

Use a funnel, not a full-repository read:

1. **Locate**: search for the exact symbol, route, model, error, or state.
2. **Read**: read only the target file plus direct dependencies.
3. **Trace**: inspect callers and persistence boundaries.
4. **Patch**: make the smallest coherent change, normally 1 concern and <=5 files.
5. **Verify**: run the narrowest relevant test first, then the repository gates.

Do not spend context reading unrelated UI, legacy code, or generated files.

## Mandatory uncertainty protocol

If two implementations appear plausible, stop and verify the repository before choosing.

For any uncertainty about:
- identity → inspect `src/lib/identity/resolve-user.ts` and `UserProfile` relations;
- onboarding → inspect the current onboarding action/routes plus migration history;
- roleplay → inspect `RoleplaySession`, `RoleplayAccess`, `RoleplayResponse`, state transitions, and start/submit endpoints;
- database performance → inspect the query and applicable `.agents/skills/supabase-postgres-best-practices` rule before changing indexes/schema;
- deployment → inspect `.github/workflows/deploy.yml`, current commit status, and build configuration.

Never invent an API or field to make the patch compile.

## State-machine invariant

Treat the persisted database state as authoritative. Do not maintain a second frontend-only state machine.

Before adding or changing a state, produce this small matrix mentally or in the task notes:

`current state → allowed action → next state → idempotent retry result → unauthorized result`

If a transition is not represented in the existing domain, add it explicitly instead of silently accepting arbitrary status strings.

## Identity invariant

Primary identity order:

`auth identity → UserProfile.id → UserProfile.interpreterId → Interpreter.id`

Email is a repair/migration key only. Never make `email + name` the permanent identity.

Every resource endpoint MUST verify ownership or an explicit privileged role. Existence of a session/resource ID is never sufficient authorization.

## Roleplay invariant

A roleplay session has exactly one target:

`interpreterId XOR recruitmentCandidateId`

Never both, never neither.

Creation must be `create-or-resume`, not unconditional `create`.

Invitation lifecycle must distinguish:

`validate → start → consume`

Validation alone must not consume an invitation.

Submission must be idempotent and transactionally protected. A repeated submit must return a stable result rather than duplicate responses/evaluations.

## Candidate-access security gate

For candidate roleplays, an authenticated candidate identity alone is not enough. Access must bind the candidate to the exact session/invitation. A check equivalent to “session is STARTED/IN_PROGRESS” without verifying candidate ownership or a valid invitation credential is prohibited.

Do not return private candidate audio, response URLs, or evaluation data until the authorization check has succeeded.

## Database discipline

Prefer, in order:

1. existing unique constraints;
2. existing indexes;
3. `upsert` / `updateMany ... WHERE state = ...` for idempotency and atomic claims;
4. short transactions;
5. targeted aggregation/pagination;
6. new indexes only when a real query requires them.

When touching Postgres/Supabase, consult the repository skill under `.agents/skills/supabase-postgres-best-practices` and use the highest-priority applicable rule first. Do not add speculative indexes.

Never introduce a new constraint until existing rows have been audited for violations.

## Low-cost verification ladder

Do not immediately run every expensive check after every edit.

For a local logic change:

1. targeted unit test;
2. related test file/suite;
3. `npm run lint`;
4. `npm run build` only after the patch stabilizes.

For Prisma/schema changes:

1. inspect existing migrations;
2. audit incompatible rows;
3. `npx prisma validate`;
4. `npx prisma generate`;
5. targeted tests;
6. full tests;
7. build.

For deployment failures, do not guess from the UI. Inspect the exact CI/Vercel/Easypanel status and error if available.

## Production gates

A change is not “done” when TypeScript compiles or a happy-path test passes.

Production readiness requires, where applicable:

- lint passes;
- tests pass;
- build passes;
- Prisma/schema validation passes;
- migration is safe and reversible/restorable;
- authorization tests pass;
- refresh/double-submit/retry/concurrency cases are covered;
- production smoke test passes;
- deployment status is green.

If a required gate cannot be executed because credentials/environment are unavailable, mark it **BLOCKED**, do not silently mark it passed.

## Regression matrix for entry routing

Verify these exact cases:

| Identity | Onboarding | Roleplay | Expected |
|---|---|---|---|
| none | — | — | `/login` |
| user | NOT_STARTED | any | onboarding |
| user | IN_PROGRESS | any | resume onboarding |
| user | NEEDS_REVIEW | any | onboarding/review |
| user | COMPLETED | INVITED | roleplay |
| user | COMPLETED | STARTED/IN_PROGRESS | resume roleplay |
| user | COMPLETED | SUBMITTED/UNDER_REVIEW | dashboard/status |
| user | COMPLETED | EVALUATED/PASSED/FAILED | result/dashboard |
| admin | any | any | admin |

## Critical current-state checks

Before claiming production readiness, explicitly re-check these repository-specific risks:

1. The latest observed `main` commit had a failing Vercel status; deployment is therefore P0 until a later green deployment is verified.
2. `src/lib/identity/resolve-user.ts` currently contains legacy roleplay-state interpretation (`PENDING`) while the documented state machine uses `DRAFT/INVITED/STARTED/IN_PROGRESS/...`; verify that persisted statuses, service transitions, migrations, and tests use one canonical vocabulary.
3. `src/lib/identity/resolve-user.ts` currently has an email/name repair fallback. It must remain a migration fallback and must never override an authoritative linked identity.
4. Candidate session access must bind the request to the candidate/invitation, not merely to the session being in an active status.
5. `src/app/page.tsx` delegates to the route-group entry router. Verify the `/entry` runtime path rather than assuming the physical `(entry)` directory is directly routable.
6. The latest repository workflow validates/tests/builds before Easypanel webhooks, but skipped webhook secrets currently produce a successful no-op. Treat “deployment skipped” as operationally incomplete for production unless the environment explicitly documents that deployment is managed elsewhere.

## Change-loop contract

Every task MUST execute this loop until the acceptance criteria are met:

`INSPECT → HYPOTHESIS → MINIMAL PATCH → TARGETED TEST → RELATED TESTS → LINT → BUILD → DIFF REVIEW → SECURITY/IDEMPOTENCY REVIEW → DEPLOY STATUS → RECHECK`

If a step fails:

1. capture the exact failure;
2. classify it as pre-existing or introduced;
3. fix only the blocking cause;
4. repeat the loop.

Do not stack speculative fixes on top of an unverified failure.

## Stop conditions

Stop changing code when:

- acceptance criteria are met;
- all applicable production gates are green;
- no known high-severity authorization/data-integrity issue remains;
- the diff is minimal and explainable;
- remaining blockers are external and explicitly documented.

Do not keep refactoring merely because another improvement is possible.
