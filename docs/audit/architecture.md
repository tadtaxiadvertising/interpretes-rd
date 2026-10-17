# Architecture Audit

Audited at commit `f6f1d00d` plus the roleplay/funnel repair change set.

## Runtime

- **Framework**: Next.js `15.2.6` (App Router), React `19.0.0`.
- **Runtime output**: `standalone` (`next.config.ts`), started with `node server.js` in a multi-stage `node:22-alpine` image.
- **Database**: PostgreSQL via Prisma `7.8.0` using `@prisma/adapter-pg` over a shared `pg.Pool` (max 5). The singleton is `src/lib/prisma.ts` (`prisma`); request flows must not call `$disconnect()`/`pool.end()`.
- **Auth**: two coexisting systems.
  - Supabase Auth session refresh + Auth.js (NextAuth 5 beta) session protection in `src/middleware.ts`.
  - Domain identity resolution in `src/lib/identity/resolve-user.ts`, exposed through `CurrentActor` (`src/lib/auth/current-actor.ts`) and `validateAction()` (`src/lib/auth/actions.ts`).

## Identity

Canonical order: `auth identity → UserProfile.id → UserProfile.interpreterId → Interpreter.id`.
- `resolveCurrentIdentity()` returns `{ userId, email, profileId, role, interpreterId, candidateId }`.
- `normalizeRbacRole()` collapses everything non-admin to `'interpreter'`; candidates are therefore role `interpreter` with `candidateId` currently always `null`.
- Admin is detected by role `admin`. Candidates are **not** a distinct RBAC role.

## Domain modules

| Module | Location | Notes |
|---|---|---|
| Identity | `src/lib/identity/resolve-user.ts` | onboarding + roleplay state helpers |
| Recruitment | `src/app/actions/recruitment.ts`, `src/services/recruitment` | candidate application persistence |
| Onboarding | `src/app/actions/onboarding.ts`, `src/services/onboarding` | configurable steps |
| Roleplay | `src/app/actions/roleplay.ts`, `src/services/roleplay`, `src/app/api/roleplay/*` | two write paths (see below) |
| Metrics/ranking | `src/services/metrics`, `src/lib/ranking` | |
| Audio | `src/lib/roleplay.ts`, `/api/roleplay/convert-audio` | signed Supabase uploads |

## Roleplay: canonical model vs. wired writers

The **canonical** data model is `RoleplaySession → RoleplayScenario → RoleplayResponse`. Admin review surfaces depend on it:

- Queue (`src/app/admin/roleplays/queue/page.tsx`) filters session status `SUBMITTED/UNDER_REVIEW/EVALUATED/PASSED/FAILED` and includes `scenarios.responses`.
- Evaluate page reads `scenarios → responses`.
- The admin "new roleplay" form submits a **`scenarios` JSON array** plus per-scenario audio.

Two parallel writers existed:

1. `src/services/roleplay/roleplay-service.ts` — models scenarios/responses fully, but had **no production caller**.
2. `src/app/actions/roleplay.ts` + `/api/admin/roleplays` — the wired path, which only stored a single `session.recordedAudioUrl` and never created scenarios.

Consequences found during audit:
- `RoleplayScenario` rows were never created in production → admin review would always be empty.
- `GET /api/roleplay/session/[id]` did not return `scenarios`/`currentScenarioIndex`, so `RoleplayClient` crashed on `session.scenarios.length`.
- Nothing transitioned a session to `SUBMITTED`.

### Repair direction taken

Keep the canonical model and make the wired path populate it (rather than deleting it or building a third system):

- `confirmRoleplayResponse` persists a `RoleplayResponse` per scenario and transitions to `SUBMITTED` on the final scenario.
- `GET /api/roleplay/session/[id]` returns `scenarios` + `currentScenarioIndex`.
- New candidate-facing `startCandidateRoleplay()` create-or-resumes a session, guarantees ≥1 scenario, and issues the `roleplay_session` cookie.
- `/postular` funnel step 3 calls it and redirects to `/roleplays/{id}`; step 4 no longer claims false completion.

## Entry routing

`src/app/page.tsx` is the single `/` route (there is **no** `(entry)` route group). It renders the public marketing page for anonymous visitors and, for an authenticated user, calls `redirect(resolveDestination(identity))` (`src/lib/identity/resolve-user.ts`), which maps onboarding + roleplay state to `/admin`, `/onboarding`, `/roleplays/{id}` or `/dashboard`. `/roleplays` is intentionally not behind `middleware.ts` auth; each roleplay route performs its own authorization. `/api/roleplay/*` is listed in the middleware public API prefixes and self-authenticates.
