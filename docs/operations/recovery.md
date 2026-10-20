# Recovery Operations

Guidance for restoring the system after incidents. This change set adds **no** schema changes and **no** migrations, so recovery does not require a data migration for the roleplay/funnel repair.

## Database recovery

- **Connection pool exhaustion** ("Cannot use a pool after calling end"): the singleton in `src/lib/prisma.ts` must never be `$disconnect()`/`pool.end()`-ed mid-flight. Restart the app container to rebuild the pool.
- **Schema drift**: compare `prisma/schema.prisma` against the live DB using `prisma migrate status` / `prisma db pull`. A prior production schema recovery is documented in `docs/ops/production-schema-recovery-2026-10-12.md`.
- **Restore**: use the provider (Supabase) point-in-time restore / backup. Prefer restore-first over ad-hoc row edits.

## Roleplay incident playbooks

### Candidate cannot start roleplay
1. Confirm the account email matches a `recruitment_candidates.email` (lowercased).
2. Confirm `startCandidateRoleplay` created/reused a session (`roleplay_sessions.recruitment_candidate_id`) and at least one `roleplay_scenarios` row.
3. Confirm a `roleplay_access` row exists for the session with `validated_at` set.
4. Confirm the browser holds the `roleplay_session` cookie equal to the session id.

### `/roleplays/[id]` shows a blank/error screen
- Cause: `GET /api/roleplay/session/[id]` not returning `scenarios`. Verify the response includes `data.scenarios` (array) and `data.currentScenarioIndex`. The client dereferences `session.scenarios.length`.

### Submission never reaches the admin queue
- The queue filters `SUBMITTED/UNDER_REVIEW/EVALUATED/PASSED/FAILED`.
- Verify the final `confirmRoleplayResponse` set `roleplay_sessions.status = 'SUBMITTED'` and created one `roleplay_responses` row per `roleplay_scenarios` row.
- Legacy `'PENDING'` status is not part of `RoleplayStatus`; if any rows show `PENDING`, they are legacy and need normalization.

### Duplicate responses
- If `roleplay_responses` shows duplicates for one scenario, the writer used an id-based upsert. The repaired confirm path uses `findFirst({ where: { scenarioId } })` + update/create.
- Clean up: keep the newest row per `scenario_id`, delete older duplicates, then add a `@@unique([scenarioId])` only after auditing for violations.

## Auditing destructive/schema changes

Before adding any constraint or dropping data: export affected rows, verify no violations, then apply. Never add a unique constraint to columns with existing duplicates.

## Rollback of this change set

The change set is code-only (6 modified files, 2 new files, no migrations). Roll back by reverting the commit; no data changes are undone because none were made.
