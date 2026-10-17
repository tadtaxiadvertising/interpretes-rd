# Repair Tracker — Free Interpreters OS

## Baseline (Commit: 1b40c975)

### Critical Current-State Checks (from AGENTS.md)

1. ✅ **Deploy status** — obsolete as written: the real deployer is Easypanel (project `database`, services `interpreters` + `interpreters-api`), not Vercel. Both services run the current `main` HEAD with `/health` returning 200 (verified Session 1–3).
2. ✅ **`resolve-user.ts` canonical vocabulary** — `computeRoleplayState` maps the persisted `RoleplayStatus` (`DRAFT/INVITED/STARTED/IN_PROGRESS/SUBMITTED/UNDER_REVIEW/EVALUATED/PASSED/FAILED/EXPIRED/CANCELLED`) 1:1. There is no `case 'PENDING'`; legacy/unknown statuses fall to `default → INVITED` as an explicit fail-safe. The session query restricts to the active/known subset. Covered by `roleplay-state.test.ts`.
3. ✅ **`resolve-user.ts` repair fallback** — both resolvers only fall back to `interpreter.findFirst({ emailCorporativo: email })` **when no authoritative `interpreterId` is linked** (`!interpreterId`, non-admin). It never overrides a linked identity, and it matches on corporate email only (no name matching).
4. ✅ **Candidate session access** binds the request to the candidate/invitation: candidate reads require the opaque server-issued `roleplay_session` cookie to equal the session id, and submits additionally require an active session state. Interpreter reads/submits require `identity.interpreterId === session.interpreterId`. Enforced and covered by tests.
5. ✅ **Entry routing** — verified: there is **no** `(entry)` route group. `src/app/page.tsx` is the sole `/` route — anonymous visitors get the marketing page; authenticated users are `redirect(resolveDestination(identity))`. The regression matrix is implemented in `resolveDestination` and covered by `roleplay-state.test.ts`. The earlier `/entry` claim in this tracker and `docs/audit/architecture.md` was stale and has been corrected.
6. ✅ **Webhook secrets** configured (`EASYPANEL_WEBHOOK_INTERPRETERS`, `EASYPANEL_WEBHOOK_API`) and verified: CI now logs `OK: interpreters deployed (HTTP 200)` / `OK: interpreters-api deployed (HTTP 200)`. Auto-deploy is functional (previously a silent no-op).

### Identified Issues — Status After Fixes

### Fixed Issues

| ID | Priority | Category | Description | Fix Applied | Status |
|---|---|---|---|---|---|
| ISSUE-001 | P1 | Roleplay | `computeRoleplayState` in `resolve-user.ts` uses `case 'PENDING'` but RoleplayStatus enum has no `PENDING` value (uses `DRAFT/INVITED/...`). | Removed `case 'PENDING'` from switch statement. Legacy `PENDING` status now falls through to `default` case which returns `INVITED`, the canonical state per the `RoleplayStatus` enum. | ✅ Fixed |
| ISSUE-004 | P2 | Roleplay | `validateInviteToken` sets `validatedAt` but comment says "Validate only - do NOT consume token". | Removed the `validatedAt` database update from `validateInviteToken`. Validation now does not consume the invitation, aligning with the invariant `validate → start → consume`. The token will be consumed (via `usedAt`) when the user actually starts the roleplay. | ✅ Fixed |

### Remaining Open Issues (No Code Bug Found)

| ID | Priority | Category | Description | Reason |
|---|---|---|---|---|
| ISSUE-002 | P2 | Onboarding | `acceptTerms` guard logic — potential gap if user has both Supabase and interpreter linkage. | Reviewed: The guard uses `!isAuthJsUser` / `else if (actor.interpreterId)` branching which correctly separates Supabase users (state on `userProfile.onboardingComplete`) from Auth.js users (state on `interpreter.documentosCompleto`). No code change needed. |
| ISSUE-003 | P2 | Identity | `resolveActorFromSupabase` email/name repair fallback. | Reviewed: The fallback only runs when `!interpreterId` (no authoritative linked identity exists), and is explicitly documented as a migration/repair fallback. Does not override authoritative linked identity. No code change needed. |
| ISSUE-005 | P3 | Dashboard | `resolveDestination` at line 453-484: if `roleplayState` is `INVITED`/`STARTED`/`IN_PROGRESS` and `roleplaySessionId` is missing, falls back to `/dashboard/roleplays` without guiding user to create/resume session. | Poor UX — user stuck with no rolepath | `src/lib/identity/resolve-user.ts:453-462` | Add guidance or auto-create session flow | N/A | Open |

### Migration & Schema Notes

- Latest migration: `1b40c975 fix(db): order roleplay status migration after enum reconciliation`
- Prisma 7.8.0 with `@prisma/adapter-pg`
- `RoleplayStatus` enum in schema.prisma: `DRAFT | INVITED | STARTED | IN_PROGRESS | SUBMITTED | UNDER_REVIEW | EVALUATED | PASSED | FAILED | EXPIRED | CANCELLED`
- No `PENDING` value in the enum — legacy code reference needs correction

### Session 2 — Roleplay end-to-end repair (Patches A–E)

Working tree based on `c06bff97`. All changes are uncommitted at the time of writing.

#### Patch A — Access & multi-scenario correctness

| ID | Priority | Category | Description | Fix Applied | Status |
|---|---|---|---|---|---|
| ISSUE-006 | P0 | Roleplay | Cross-session write: `confirmRoleplayResponse` accepted any `scenarioId` without verifying it belongs to the session (IDOR). | Ownership is checked first; a supplied `scenarioId` must resolve to a `RoleplayScenario` in this session or the write is rejected. | ✅ Fixed |
| ISSUE-007 | P1 | Roleplay | Multi-scenario blocked: guard on `session.recordedAudioUrl` + `where { recordedAudioUrl: null }` rejected every scenario after the first. | Progress is derived from persisted `RoleplayResponse` count for the session; `isFinal = respondedCount >= totalScenarios`; the stale `recordedAudioUrl: null` guard was removed. | ✅ Fixed |
| ISSUE-008 | P1 | Roleplay | `startCandidateRoleplay` forced `status: 'STARTED'` on already submitted/evaluated sessions (state regression). | Promotion is limited to `DRAFT/INVITED/PENDING → STARTED`. | ✅ Fixed |
| ISSUE-009 | P1 | Roleplay | Retried confirm could duplicate responses/evaluations. | A confirm whose response is already recorded returns a stable success; sessions completed twice cannot advance twice because progress is derived from the DB count. | ✅ Fixed |

#### Patch B — Admin multi-scenario creation

| ID | Priority | Category | Description | Fix Applied | Status |
|---|---|---|---|---|---|
| ISSUE-010 | P1 | Admin | `POST /api/admin/roleplays` ignored the `scenarios` JSON payload, so admin-created sessions had no `RoleplayScenario` rows (no scripts, no per-scenario audio). | The route validates 1–10 scenarios (title ≤200, `durationLimitSec` 0–86400, `scriptPrompt` ≤5000), requires one base audio per scenario (≤15 MB, allow-listed MIME types), creates the session as `DRAFT`, uploads audio to `base/{sessionId}/{i}.{ext}`, and creates the `RoleplayScenario` rows in a transaction with `session.baseAudioUrl = audios[0]`. Failures clean up the session (cascade) and uploaded objects and return a generic 500. | ✅ Fixed |
| ISSUE-011 | P1 | Admin | `NewRoleplayForm` called the non-existent `/api/admin/roleplays/scenarios/audio` and silently swallowed failures. | The form now sends one atomic multipart request (`scenarios` JSON + repeated `scenarioAudios`); the dead follow-up loop was removed. | ✅ Fixed |

#### Patch C — Persisted audio path & self-assessment

| ID | Priority | Category | Description | Fix Applied | Status |
|---|---|---|---|---|---|
| ISSUE-012 | P1 | Roleplay | `sourceAudioPath` and `durationSec` were never persisted; `selfScore`/`selfNotes` stayed in React state only. | `confirmRoleplayResponse` accepts `sourceAudioPath`/`durationSec` and persists them on the response row. `RoleplayClient` forwards `convert-audio`'s `sourcePath` and the recording duration. New `saveSelfAssessment(sessionId, scenarioId, scores, notes)` action persists `selfScore` (scores map) and `selfNotes`, gated by the same ownership/scenario checks and requiring an already confirmed response. | ✅ Fixed |
| ISSUE-013 | P2 | Roleplay | `RoleplayClient` overwrote the stored audio `duration` with `0`, so the completion screen summed `totalDuration` to 0. | The confirmed URL and duration are stored per scenario and merged (not replaced) when the self-assessment completes. | ✅ Fixed |

#### Patch D — Roleplay service persistence

| ID | Priority | Category | Description | Fix Applied | Status |
|---|---|---|---|---|---|
| ISSUE-014 | P2 | Roleplay | `roleplayService.saveResponse` used `upsert({ where: { id: scenarioId } })`, which created a new response row per call (row duplication) and wrote the audio URL into `sourceAudioPath`. | Replaced with `findFirst({ where: { scenarioId } })` → `update`/`create`, and a dedicated optional `sourceAudioPath` argument. Dead candidate check that required a never-written `usedAt` was corrected to require an access row. | ✅ Fixed |

#### Patch E — Invitation enter/resume lifecycle

| ID | Priority | Category | Description | Fix Applied | Status |
|---|---|---|---|---|---|
| ISSUE-015 | P1 | Roleplay | The invite link flow (`/r/{code}` → validate-by-code) never bound the browser to the session and never left `DRAFT`, so the candidate could not open or resume the attempt (`403 Access denied`). | Both `validate-invite` and `validate-invite-by-code` now set the `roleplay_session` cookie, accept `DRAFT/INVITED/PENDING/STARTED/IN_PROGRESS` (so an interrupted attempt resumes), move `DRAFT/INVITED/PENDING → STARTED` and stamp `startedAt`. Consumption (`usedAt`) is never triggered by validation. | ✅ Fixed |
| ISSUE-016 | P1 | Roleplay | Interpreter sessions created by an admin could never be submitted: nothing transitioned `DRAFT → STARTED`, and confirm rejects non-active sessions. `/api/roleplay/start` existed but had no caller. | New `POST /api/roleplay/session/[id]/start` (owner- or admin-only, idempotent for `STARTED/IN_PROGRESS`, `409` for terminal states) is called by `RoleplayClient.handleStartRoleplay` before the attempt begins. | ✅ Fixed |
| ISSUE-017 | P2 | Roleplay | `RoleplayClient` refetched the session on every step change (effect depended on `pageState`) and used a stale `pageState` in `finally`, causing refetch churn and wrong initial step. | Effect now depends on `sessionId` only; the initial step is chosen from the loaded status, and terminal statuses (`SUBMITTED…FAILED`) open the completion view instead of the intro. | ✅ Fixed |

#### Tests added (Patch A–E)

- `roleplay-candidate-access.test.ts`: +16 tests (IDOR, multi-scenario progress, stray confirm, idempotent replay, legacy single-submit semantics, `sourceAudioPath`/`durationSec` persistence, `saveSelfAssessment` ownership/missing-response/happy path).
- `roleplay-start-candidate.test.ts`: +`it.each` non-regression for `SUBMITTED/UNDER_REVIEW/EVALUATED/PASSED/FAILED`.
- `src/app/api/roleplay/session/[id]/start/__tests__/route.test.ts`: 7 tests.
- `src/app/api/roleplay/session/[id]/__tests__/route.test.ts`: 5 tests (candidate cookie binding incl. submitted read-only reload).
- `src/app/api/roleplay/validate-invite-by-code/__tests__/route.test.ts`: 4 tests.

#### Gates (this session)

- `npm run lint` ✅ (0 errors; 3 pre-existing `react-hooks/exhaustive-deps` warnings)
- `npm run test` ✅ 168 tests / 20 files
- `npm run build` ✅
- `npx prisma validate` ✅

#### Residuals (documented, not blocking)

1. **Invitation consumption**: resolved in Session 3 (ISSUE-018). `access.usedAt` is now written exactly once, transactionally, when a candidate submits the final scenario (session → `SUBMITTED`). Validation and start still never consume.
2. **Self-assessment `criticalError`** is not persisted (no column). `selfScore` (numeric map) and `selfNotes` are.
3. **Legacy admin reader** `admin/roleplays/[id]/page.tsx` expects a nested `selfScore.criticalError` / `selfScore.selfNotes` shape, while `admin/roleplays/evaluate/[id]` and the schema use a flat scores map + the `selfNotes` column. The persisted shape follows the evaluate page/schema convention.
4. **Invite code collision**: `POST /api/admin/roleplays` generates an 8-char code without an insert-retry on the unique constraint (a collision returns a 500 after cleanup).
5. **No unique constraint** on `RoleplayResponse.scenarioId`; one-row-per-scenario is enforced by `findFirst` + update/create, not by the database.
6. **Dead code (unwired)**: the `validateInviteToken` server action has no callers (the invite pages call the `/api/roleplay/validate-invite*` routes), and `/api/roleplay/start` (raw-token start) also has no callers. Both were left in place; if they are ever wired they must reuse the cookie + start semantics of the routes.
7. **ISSUE-004 clarified**: the mandate was "validation must not consume the invitation". Consumption is `access.usedAt`, now written by `confirmRoleplayResponse` on submission (Session 3 / ISSUE-018) and never by validation. `access.validatedAt` is only a validated-access marker (used by the session GET to decide whether a candidate may see scenario audio), and Patch E intentionally writes it on the validate routes together with `startedAt`.

### Session 3 — Invitation lifecycle: consume-on-submit (ISSUE-018)

Working tree based on `52df690e`.

The AGENTS.md invariant `validate → start → consume` requires the three steps to
be distinct and forbids validation from consuming. Validation and start were
already non-consuming; the consume step was missing (nothing wrote
`access.usedAt`), so the `if (access.usedAt)` guards in the invite routes and the
candidate audio gate (`validatedAt && !usedAt` in
`GET /api/roleplay/session/[id]`) were effectively dead.

| ID | Priority | Category | Description | Fix Applied | Status |
|---|---|---|---|---|---|
| ISSUE-018 | P1 | Roleplay | The invitation was never consumed: `access.usedAt` was never written, so a single-use invitation remained valid until `expiresAt` and the audio gate never activated. | `confirmRoleplayResponse` now claims the invitation inside the same transaction that moves the session to `SUBMITTED`, using an atomic `updateMany({ where: { sessionId, usedAt: null } })`. Candidate-only, idempotent, no double-consume on retry/concurrency. | ✅ Fixed |

**Consume point rationale (verified against the repository):** the canonical
(though unwired) `roleplayService.submitAssessment` consumes on the
`IN_PROGRESS → SUBMITTED` transition ("If candidate, consume the access token
now"), and the candidate audio gate hides audio once `usedAt` is set — so the
invitation must stay valid (unconsumed) while the candidate is recording. The
consume point is therefore submission, not start. Consuming at start would blank
the recorder audio.

**Tests added:** `roleplay-candidate-access.test.ts` +4 — consume on final
scenario, no consume on a non-final scenario, no consume for interpreter
sessions, no re-consume on an already-submitted replay.

**Gates (Session 3):** lint ✅ (0 errors, 3 pre-existing warnings) ·
`npm run test` ✅ 172 tests / 20 files · `npx tsc --noEmit` ✅ · `npm run build` ✅.

### Session 4 — Onboarding admin configurability (plan #12)

Working tree based on `3e4fda7c`.

**Verification (plan #12: "verify admin UI edits actually drive `src/services/onboarding`").**

- Admin entry points: `InterpreterOnboardingPanel` (`/admin/users`, opened with `user.id` = `UserProfile.id`) and `BankingInfoCard` (`/interpreters`, given `interpreter.userProfile.id`).
- Both call the admin-guarded actions in `src/app/actions/admin-onboarding.ts` (`validateAction('admin')`).
- `adminUpdateOnboardingDetails` writes the banking fields to **both** `userProfile` (bankName/bankAccount/bankAccountType/bankCedula + `onboardingComplete`) and the linked `interpreter` (banco/cuentaPago/tipoCuenta/cedulaRnc + `documentosCompleto`); `adminResetOnboarding` nulls the same fields.
- Onboarding state is derived by `resolveCurrentIdentity` → `computeOnboardingStatus` from exactly those fields (Supabase: profile; Auth.js: interpreter). The onboarding service (`getOnboardingState`) and the live status action (`getOnboardingStatus`) read the same source. **Conclusion: admin edits do drive onboarding state.** IDs and the authorization guard are correct.

| ID | Priority | Category | Description | Fix Applied | Status |
|---|---|---|---|---|---|
| ISSUE-019 | P2 | Onboarding | Editing banking from `/interpreters` (`BankingInfoCard`) persisted correctly but the actions only revalidated `/admin/users` (+ `/dashboard` on reset), never `/interpreters`, so the roster card could render stale banking data after an edit. | `adminUpdateOnboardingDetails` and `adminResetOnboarding` now also `revalidatePath('/interpreters')` (and update now revalidates `/dashboard` for parity with reset). | ✅ Fixed |

**Tests added:** new `src/app/actions/__tests__/admin-onboarding.test.ts` (7 tests) — non-admin rejected without touching the DB; `getOnboardingDetails` happy path + `NOT_FOUND`; update mirrors onto profile **and** interpreter; update/reset revalidate `/admin/users`, `/interpreters`, `/dashboard`; invalid banking data rejected before persisting. (Previously this action file had **no** tests.)

**Residual (documented, not blocking):** `src/services/onboarding/onboarding-service.ts` is a **dead duplicate** of the live `src/app/actions/onboarding.ts` — only tests import it, no runtime path uses it. Consolidating/removing it is the onboarding analog of the roleplay "consolidate writers" item (plan #9) and was intentionally left as a separate decision. Also noted: `adminUpdateOnboardingDetails` sets `onboardingComplete`/`documentosCompleto` to `true` unconditionally (admin completing on the interpreter's behalf); behavior unchanged.

**Gates (Session 4):** lint ✅ (0 errors, 3 pre-existing warnings) ·
`npm run test` ✅ 185 tests / 21 files · `npx tsc --noEmit` ✅.

### Commands to Run (baseline)

```bash
npm run lint
npm run build
npm run test
npx prisma validate
npx prisma generate
```

### Blockers

- Missing `AUTH_SECRET` in environment — production auth will fail closed
- Missing `AUTH_TRUST_HOST=true` — may cause UntrustedHost errors
- Database connection not available for integration tests