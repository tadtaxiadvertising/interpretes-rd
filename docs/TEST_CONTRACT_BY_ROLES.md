# Test Contract by Roles — Interpretes RD

> **Version**: 1.0
> **Date**: 2026-10-29
> **Status**: Active
> **Scope**: Unit, integration, and end-to-end testing strategy organized by actor role.
> **Companion files**: `AGENTS.md` (production protocol), `docs/PROJECT_STATUS.md`.

---

## 1. Purpose

This contract defines **what must be tested, by which role, and with what invariants** so that every change to Interpretes RD is verified from the perspective of each actor that can touch the system. It is the single source of truth for the testing matrix; new features and bug fixes must update this document when they introduce new roles, states, or transitions.

## 2. Roles (Actors)

| Role ID | Name | Auth provider | Identity anchor | Scope |
|---|---|---|---|---|
| `ANON` | Anonymous visitor | none | — | Public marketing, application form, invite validation |
| `CANDIDATE` | Recruitment candidate | session cookie (`roleplay_session`) + recruitment candidate id | `RecruitmentCandidate.id` | Own application, own roleplay session, own audio/responses |
| `INTERPRETER` | Hired interpreter | Supabase / Auth.js | `UserProfile.id` → `Interpreter.id` | Own dashboard, own roleplays, own production metrics |
| `ADMIN` | Administrator | Auth.js (RBAC) | `UserProfile.id` with admin role | All candidates, interpreters, roleplays, reports, config |
| `SYSTEM` | Background/cron job | service token | — | Aggregations, cleanup, scheduled tasks |

> **Identity invariant** (from `AGENTS.md`): `auth identity → UserProfile.id → UserProfile.interpreterId → Interpreter.id`. Email is a repair/migration key only.

## 3. Canonical State Vocabularies

### 3.1 Onboarding status
`NOT_STARTED | IN_PROGRESS | COMPLETED | NEEDS_REVIEW`

### 3.2 Roleplay session status
`DRAFT | INVITED | STARTED | IN_PROGRESS | SUBMITTED | UNDER_REVIEW | EVALUATED | PASSED | FAILED | EXPIRED | CANCELLED`

> ⚠️ `PENDING` is **not** a valid roleplay status (removed in v3.6.0). Any persisted `PENDING` indicates data corruption or a missing migration. Code must fail-fast on unknown values.

### 3.3 Recruitment application status
See `src/services/recruitment/transitions.ts` and `src/lib/prisma-types.ts`. Includes `CONTRACT_PENDING`, `READY_FOR_ACTIVATION`, `HIRED`, etc.

## 4. Authorization Invariants (must hold for every endpoint)

1. **Existence ≠ authorization.** A valid resource ID alone never grants access.
2. **Ownership check.** Every resource endpoint verifies the caller owns the resource OR holds an explicit privileged role.
3. **Candidate binding.** A candidate may only access a roleplay session when:
   - the `roleplay_session` cookie equals the session id, **and**
   - the session status is in `{STARTED, IN_PROGRESS, SUBMITTED, UNDER_REVIEW, EVALUATED, PASSED, FAILED}`.
4. **Interpreter binding.** An interpreter may only access sessions where `session.interpreterId === identity.interpreterId`.
5. **Admin override.** Admins may access any resource but every admin action is audited (event log).
6. **No private data leakage.** Candidate audio URLs, response URLs, and evaluation data are never returned until the authorization check succeeds.

## 5. Regression Matrix — Entry Routing

Source: `AGENTS.md` § "Regression matrix for entry routing". Verified by `src/lib/identity/__tests__/entry-routing-matrix.test.ts`.

| Identity | Onboarding | Roleplay | Expected destination |
|---|---|---|---|
| none | — | — | `/login` (anonymous → marketing) |
| user (interpreter) | NOT_STARTED | any | `/onboarding` |
| user (interpreter) | IN_PROGRESS | any | `/onboarding?resume=true` |
| user (interpreter) | NEEDS_REVIEW | any | `/onboarding` (review) |
| user (interpreter) | COMPLETED | INVITED | `/roleplays/{sessionId}` |
| user (interpreter) | COMPLETED | STARTED | `/roleplays/{sessionId}` |
| user (interpreter) | COMPLETED | IN_PROGRESS | `/roleplays/{sessionId}` |
| user (interpreter) | COMPLETED | SUBMITTED | `/dashboard` |
| user (interpreter) | COMPLETED | UNDER_REVIEW | `/dashboard` |
| user (interpreter) | COMPLETED | EVALUATED | `/dashboard` |
| user (interpreter) | COMPLETED | PASSED | `/dashboard` |
| user (interpreter) | COMPLETED | FAILED | `/dashboard` |
| user (interpreter) | COMPLETED | EXPIRED | `/dashboard` |
| user (interpreter) | COMPLETED | CANCELLED | `/dashboard` |
| user (interpreter) | COMPLETED | NO_ROLEPLAY | `/dashboard` |
| admin | any | any | `/admin` |

## 6. Test Layers

| Layer | Tool | Location | When to run |
|---|---|---|---|
| Unit (pure logic) | Vitest | `src/**/__tests__/*.test.ts` | Every commit |
| Integration (actions/API with mocked Prisma) | Vitest | `src/**/__tests__/*.test.ts` | Every commit |
| E2E (browser + real DB) | Playwright | `e2e/*.spec.ts` | Isolated DB only (`E2E_ALLOW_RUN=true`) |
| Build gate | `npm run build` | — | Before deploy |

## 7. Strategic Test Scenarios (by role)

### 7.1 ANONYMOUS
- [ ] `ANON-01` Visiting `/` renders marketing page (no redirect).
- [ ] `ANON-02` `/postular` form submission creates exactly one candidate (idempotency, concurrency).
- [ ] `ANON-03` Duplicate email submission returns safe "sign in" message, no data overwrite.
- [ ] `ANON-04` Invite validation endpoints (`/api/roleplay/validate-invite`, `validate-invite-by-code`) are publicly reachable and do not consume the invitation.
- [ ] `ANON-05` Protected endpoints (`/api/roleplay/session/[id]`, admin routes) return 401/403 without credentials.

### 7.2 CANDIDATE
- [ ] `CAND-01` Candidate with valid `roleplay_session` cookie can GET/START/submit own session.
- [ ] `CAND-02` Candidate without cookie is rejected (401/Unauthorized).
- [ ] `CAND-03` Candidate with mismatched cookie is rejected.
- [ ] `CAND-04` Candidate accessing session in non-accessible state (DRAFT/INVITED before start) is rejected for read; allowed for start/resume in `{DRAFT, INVITED, PENDING-legacy, STARTED, IN_PROGRESS}`.
- [ ] `CAND-05` Cross-session write (scenario id from another session) is rejected.
- [ ] `CAND-06` Idempotent retry of an already-recorded response returns success without duplicate writes.
- [ ] `CAND-07` Double-submit of final scenario consumes invitation exactly once.
- [ ] `CAND-08` Non-final scenario does not consume invitation or advance application.
- [ ] `CAND-09` Final scenario advances recruitment application `ROLEPLAY_IN_PROGRESS → ROLEPLAY_REVIEW` with version guard.
- [ ] `CAND-10` Concurrent final submits do not duplicate `ROLEPLAY_SUBMITTED` events (version guard → count 0 skips event).
- [ ] `CAND-11` Self-assessment persists only for owning candidate + existing confirmed response.
- [ ] `CAND-12` Candidate cannot read another candidate's audio/response/evaluation URLs.

### 7.3 INTERPRETER
- [ ] `INT-01` Interpreter sees own dashboard after onboarding completion.
- [ ] `INT-02` Interpreter with `INVITED/STARTED/IN_PROGRESS` roleplay is routed to `/roleplays/{id}`.
- [ ] `INT-03` Interpreter cannot access another interpreter's session (`session.interpreterId !== identity.interpreterId` → 403).
- [ ] `INT-04` Interpreter cannot access candidate sessions.
- [ ] `INT-05` Interpreter roleplay submit does not consume an invitation (`roleplayAccess.updateMany` not called).
- [ ] `INT-06` Interpreter roleplay submit does not advance any recruitment application.
- [ ] `INT-07` Interpreter cannot perform admin actions (delete candidate, hire, mark ready) → 403.

### 7.4 ADMIN
- [ ] `ADM-01` Admin is routed to `/admin` regardless of onboarding/roleplay state.
- [ ] `ADM-02` Admin can list/filter recruitment candidates (status validation rejects unknown).
- [ ] `ADM-03` Admin can delete candidate; active roleplay sessions are cancelled in the same transaction.
- [ ] `ADM-04` Admin can mark application ready for activation (idempotent: already-ready returns `changed: false`).
- [ ] `ADM-05` Admin can hire candidate → creates/reuses interpreter, advances application to `HIRED`.
- [ ] `ADM-06` Hire is idempotent: already-hired returns existing `interpreterId`.
- [ ] `ADM-07` Admin cannot hire unless application is `READY_FOR_ACTIVATION` or `HIRING`.
- [ ] `ADM-08` Admin audio upload errors surface to UI; storage bucket ensured.
- [ ] `ADM-09` Admin cannot access candidate audio without ownership (admin override allowed but audited).

### 7.5 SYSTEM
- [ ] `SYS-01` Tariff config (`DEFAULT_INTERPRETER_TARIFF_PER_MINUTE`) missing → hire fails with `SERVICE_UNAVAILABLE` (no partial write).
- [ ] `SYS-02` Concurrent hire of same candidate does not create duplicate interpreters (email-keyed reuse).

## 8. Test File Inventory

### Existing (keep & extend)
| File | Role coverage | Notes |
|---|---|---|
| `src/lib/identity/__tests__/resolve-user.test.ts` | ANON/INTERPRETER routing | extend with matrix cases |
| `src/lib/identity/__tests__/roleplay-state.test.ts` | state vocab | fail-fast on unknown |
| `src/lib/identity/__tests__/resolve-user-onboarding.test.ts` | onboarding | — |
| `src/app/actions/__tests__/roleplay-candidate-access.test.ts` | CANDIDATE | candidate gate + idempotency |
| `src/app/actions/__tests__/roleplay-evaluate.test.ts` | ADMIN/INTERPRETER | evaluation |
| `src/app/actions/__tests__/recruitment.test.ts` | ADMIN/CANDIDATE | recruitment actions |
| `src/app/api/roleplay/session/[id]/__tests__/route.test.ts` | CANDIDATE/INTERPRETER | session access |
| `src/app/api/roleplay/session/[id]/start/__tests__/route.test.ts` | CANDIDATE/INTERPRETER | start/resume |
| `src/app/api/admin/roleplays/__tests__/route.test.ts` | ADMIN | admin roleplays |
| `e2e/recruitment-duplicate-submit.spec.ts` | ANON | concurrency |

### New (to create)
| File | Role coverage | Purpose |
|---|---|---|
| `src/lib/identity/__tests__/entry-routing-matrix.test.ts` | all | Full AGENTS.md regression matrix for `resolveDestination` |
| `src/app/actions/__tests__/role-based-access.test.ts` | cross-role | Admin/interpreter/candidate cannot cross boundaries |
| `src/app/actions/__tests__/recruitment-idempotency.test.ts` | ADMIN/SYSTEM | mark-ready & hire idempotency + version guards |

## 9. Idempotency & Concurrency Requirements

Every state-changing operation must declare:
- `current state → allowed action → next state → idempotent retry result → unauthorized result`

Operations requiring idempotency tests:
1. Recruitment application submission (email-keyed, concurrent-safe).
2. Roleplay response confirm (retried confirm = success, no duplicate).
3. Final scenario submit (invitation consumed exactly once).
4. Application advance (`ROLEPLAY_IN_PROGRESS → ROLEPLAY_REVIEW`) with version guard.
5. Mark application ready (already-ready = `changed: false`).
6. Hire candidate (already-hired = existing interpreterId).

## 10. Test Data & Fixtures

- Unit/integration tests use **mocked Prisma** (`vi.mock('@/lib/prisma')`). No real DB.
- E2E tests require `E2E_DATABASE_URL` and `E2E_ALLOW_RUN=true`. They must use an isolated DB; never run against production.
- Test emails must be unique per run (`${RUN_ID}` suffix) to avoid collisions.
- Cleanup: `e2e/global-teardown.ts` removes test rows.

## 11. Gates (must all pass before "done")

1. `npm run test` — all unit/integration tests green.
2. `npm run lint` — no errors (warnings acceptable, document them).
3. `npm run build` — production build succeeds.
4. `npx prisma validate` + `npx prisma generate` — schema valid (if schema touched).
5. Authorization tests pass (cross-role boundaries).
6. Refresh/double-submit/retry/concurrency cases covered for changed flows.
7. E2E smoke (when DB available) — `npm run test:e2e`.

## 12. How to Add a New Test

1. Identify the role(s) affected.
2. Add a scenario ID (`ROLE-NN`) to §7 of this contract.
3. Create/extend the test file listed in §8.
4. Use the mocked-Prisma pattern from `src/app/actions/__tests__/roleplay-candidate-access.test.ts`.
5. Assert both the happy path AND the unauthorized/invalid-state path.
6. Run `npm run test` for the touched file before committing.

## 13. Change Log

| Date | Change | Author |
|---|---|---|
| 2026-10-29 | Initial contract created | agent |
