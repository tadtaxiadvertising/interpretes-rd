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
7. **Persist audio paths** — accept and store `sourceAudioPath`/`processedAudioPath` in the confirm path so admin review can re-sign audio after URL expiry.
8. **Persist self-assessment** — send `selfScore`/`selfNotes` with the confirm call.
9. **Consolidate roleplay writers** — either wire `roleplayService` into production or remove it, and fix `saveResponse`'s `{ id: scenarioId }` upsert bug.

## P2 — hardening / consistency

10. **Canonicalize roleplay status vocabulary** — remove legacy `'PENDING'` comparisons or backfill rows; keep one vocabulary.
11. **Admin queue/UX** — reflect `SUBMITTED/UNDER_REVIEW` transitions and reviewer claims via `/api/admin/roleplays/claim`.
12. **Onboarding admin configurability** — verify admin UI edits actually drive `src/services/onboarding`. ✅ Verified (Session 4): admin actions write the same `userProfile`/`interpreter` fields the resolver reads; added `revalidatePath('/interpreters')` (ISSUE-019) and `admin-onboarding.test.ts`. Residual: `src/services/onboarding/onboarding-service.ts` is an unwired duplicate of `src/app/actions/onboarding.ts`.
13. **`/postular` step 2 assets** — wire the PDF/glossary buttons or remove them.

## Acceptance criteria for the shipped slice

- `/postular` step 3 either starts or resumes a candidate session and navigates to the recorder.
- The recorder loads without crashing (scenarios present).
- Submitting every scenario moves the session to `SUBMITTED` and creates one `RoleplayResponse` per scenario.
- Unauthenticated candidate access is refused; candidate ownership is bound by cookie.
- lint / tests / build green.

## Verification loop

`INSPECT → HYPOTHESIS → MINIMAL PATCH → TARGETED TEST → RELATED TESTS → LINT → BUILD → DIFF REVIEW → SECURITY/IDEMPOTENCY REVIEW → DEPLOY STATUS → RECHECK`.
