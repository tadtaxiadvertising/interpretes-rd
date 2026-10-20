# Implementation Plan

Derived from the audit at `f6f1d00d`. Priorities ordered by candidate-impact and data-integrity risk.

## P0 — shipped in this change set

1. **Candidate roleplay entry** — `startCandidateRoleplay()` in `src/app/actions/roleplay.ts`: login-gated, create-or-resume by candidate email, guarantees ≥1 `RoleplayScenario`, upserts `RoleplayAccess`, sets the `roleplay_session` cookie.
2. **Funnel wiring** — `/postular` step 3 calls the action and redirects to `/roleplays/{sessionId}`; step 4 no longer claims false completion.
3. **Scenario read path** — `GET /api/roleplay/session/[id]` returns `scenarios` + `currentScenarioIndex` (was crashing the client).
4. **Response write path** — `confirmRoleplayResponse` persists a `RoleplayResponse` per scenario and transitions to `SUBMITTED` on the final scenario.
5. **Login/register return-to** — `?next=` support with `safeNextPath` open-redirect guard.

## P1 — next, not in this change set

6. **Admin multi-scenario creation** — `POST /api/admin/roleplays` now parses the `scenarios` JSON, creates one `RoleplayScenario` row per scenario, and attaches per-scenario base audio **in the same multipart request** (`scenarioAudios`), so no separate `POST /api/admin/roleplays/scenarios/audio` route is needed. Implemented in `52df690e`; the live `NewRoleplayForm` posts this shape. ✅ Verified + regression-tested (Session 5). The old single-`baseAudio` + `/scenarios/audio` shape (referenced by the original audit's "feature matrix row 12") survives **only** in the untracked archived copies under `Interpreter Plastform/`, which are not part of the build.
7. **Persist audio paths** — accept and store `sourceAudioPath`/`processedAudioPath` in the confirm path so admin review can re-sign audio after URL expiry. `sourceAudioPath` was already stored in `52df690e`; this session wired **admin re-sign** (`evaluate/[id]` re-signs the stored path via `getAdminReviewUrl`, helper `src/lib/roleplay-review.ts`) and fixed the async MP3 job that wrote `processedAudioPath` to the wrong response (order derived from a cuid) and used a non-singleton Prisma client (`src/lib/roleplay-audio-conversion.ts`). ✅ Fixed + tested (Session 6 / ISSUE-021, ISSUE-022). Residual: fire-and-forget conversion can race the `RoleplayResponse` insert (degrades to `sourceAudioPath` fallback).
8. **Persist self-assessment** — send `selfScore`/`selfNotes` with the confirm call.
9. **Consolidate roleplay writers** — [x] `saveResponse` upsert now keyed on `scenarioId` + `scenario: { sessionId }` (Session 7). The parallel `roleplayService` (`src/services/roleplay/roleplay-service.ts`) and its repositories (`src/repositories/roleplay/*`) were **unwired** (only their own test imported them) and diverged from the live actions (different score weights, looser transitions, a token-consumption bug); they were **removed** (Session 7). The live writers in `src/app/actions/roleplay.ts` remain canonical.

## P2 — hardening / consistency

10. **Canonicalize roleplay status vocabulary** — [x] removed the legacy `'PENDING'` case from `mapDbStatusToState` (Session 7); one vocabulary (`VALID_STATUSES`) remains. `resolve-user.ts` uses the canonical states.
11. **Admin queue/UX** — reflect `SUBMITTED/UNDER_REVIEW` transitions and reviewer claims via `/api/admin/roleplays/claim`. [x] Re-pointed the queue to the live `/admin/roleplays/[id]` review page, removed the inert `/admin/roleplays/evaluate/[id]` mock and the orphan `/api/admin/roleplays/evaluate` + `/api/admin/roleplays/claim` routes, fixed the legacy `PENDING`/`EVALUATED` badge map on the roleplays list, and rendered the assigned evaluator's name/email in the queue (Session 7). Claiming happens atomically when the evaluation is submitted (`evaluateRoleplay`).
12. **Onboarding admin configurability** — verify admin UI edits actually drive `src/services/onboarding`. ✅ Verified (Session 4): admin actions write the same `userProfile`/`interpreter` fields the resolver reads; added `revalidatePath('/interpreters')` (ISSUE-019) and `admin-onboarding.test.ts`. [x] The unwired duplicate `src/services/onboarding/onboarding-service.ts` was removed (Session 7); `src/app/actions/onboarding.ts` is canonical.
13. **`/postular` step 2 assets** — [x] removed the non-wired PDF/glossary buttons and the inert video placeholder (Session 7).

## Acceptance criteria for the shipped slice

- `/postular` step 3 either starts or resumes a candidate session and navigates to the recorder.
- The recorder loads without crashing (scenarios present).
- Submitting every scenario moves the session to `SUBMITTED` and creates one `RoleplayResponse` per scenario.
- Unauthenticated candidate access is refused; candidate ownership is bound by cookie.
- lint / tests / build green.

## Verification loop

`INSPECT → HYPOTHESIS → MINIMAL PATCH → TARGETED TEST → RELATED TESTS → LINT → BUILD → DIFF REVIEW → SECURITY/IDEMPOTENCY REVIEW → DEPLOY STATUS → RECHECK`.
