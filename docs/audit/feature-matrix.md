# Feature Matrix

Status legend: **DONE** verified working, **PARTIAL** works with gaps, **BROKEN** known non-functional, **UNVERIFIED** not executed in this environment.

| # | Feature | Status | Evidence / Notes |
|---|---|---|---|
| 1 | Candidate application form persists (`/postular` step 1) | DONE | `submitApplicationAction` create-or-resume; `src/app/actions/__tests__/recruitment.test.ts` |
| 2 | `/postular` step 2 (induction material) | PARTIAL | Static content only; PDF/glossary buttons are non-wired placeholders |
| 3 | `/postular` step 3 starts roleplay | DONE (repaired) | Now calls `startCandidateRoleplay()`; login-gated; redirects to `/roleplays/{id}` |
| 4 | `/postular` step 4 completion claim | DONE (repaired) | Removed false "has completado las pruebas"; honest scheduling copy |
| 5 | Login redirect to `?next=` | DONE (added) | `login/page.tsx` + `src/lib/auth/safe-next.ts` |
| 6 | Register redirect to `?next=` | DONE (added) | `register/page.tsx` |
| 7 | Candidate roleplay access (login then `/roleplays/[id]`) | PARTIAL | `startCandidateRoleplay` issues cookie; GET returns scenarios; recorder UI unverified end-to-end |
| 8 | GET roleplay session returns scenarios | DONE (repaired) | `scenarios` + `currentScenarioIndex` added |
| 9 | Per-scenario response persistence | DONE (repaired) | `confirmRoleplayResponse` writes `RoleplayResponse` when `scenarioId` supplied |
| 10 | Session transitions to `SUBMITTED` | DONE (repaired) | Final scenario sets `status: 'SUBMITTED'` |
| 11 | Admin roleplay queue shows submissions | PARTIAL | Filter unchanged; now reachable because statuses can reach `SUBMITTED` |
| 12 | Admin create multi-scenario roleplay | BROKEN | Form POSTs `scenarios` JSON that the API ignores; additional per-scenario audio POSTs to a non-existent `/api/admin/roleplays/scenarios/audio` |
| 13 | Admin evaluate roleplay | PARTIAL | Reads `scenarios → responses`; now populated for submissions, but signed URL expiry (`source_audio_url`) is a known limitation |
| 14 | Invite link/`/r/[code]` flows | UNVERIFIED | Token validate/start routes exist; not exercised here |
| 15 | Onboarding configurable steps | UNVERIFIED | `src/services/onboarding` + tests pass; admin UI not exercised |
| 16 | Metrics / ranking | UNVERIFIED | Unit tests pass; not exercised against live data |
| 17 | Audio conversion (`/api/roleplay/convert-audio`) | PARTIAL | Route + rate limit + tests pass; requires Supabase creds for real conversion |

## Known gaps (not fixed in this change set)

- Admin multi-scenario creation (row 12): `POST /api/admin/roleplays` ignores the `scenarios` field and `/api/admin/roleplays/scenarios/audio` does not exist.
- `RoleplayResponse.source_audio_url` stores a short-lived signed URL; `source_audio_path` is not persisted by the confirm path, so admin playback after expiry may fail.
- Self-assessment (`selfScore`/`selfNotes`) is client-only and not persisted by the confirm path.
- `src/services/roleplay/roleplay-service.ts#saveResponse` upserts by `{ id: scenarioId }` (never matches; `RoleplayResponse.id` is a cuid) → duplicate rows on repeated autosave. Only reachable from its own test.
