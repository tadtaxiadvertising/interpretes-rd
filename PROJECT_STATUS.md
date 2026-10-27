# Project Status - Interpretes RD

**Last Updated**: 2026-10-27
**Branch**: main
**Commit**: Up to date with origin/main

## Current State Summary

### Completed Security Fixes (P0 - Security & Data Protection)

1. **Middleware Public API Exception Fixed** (`src/middleware.ts`)
   - Removed blanket `/api/roleplay/*` public access
   - Only explicitly public endpoints: `/api/roleplay/validate-invite`, `/api/roleplay/validate-invite-by-code`, `/api/roleplay/start`
   - Protected endpoints now require authentication + ownership checks

2. **Rate Limiting Fixed** (`src/lib/security/rate-limit.ts`)
   - Replaced IP-only identification with IP + User-Agent hash
   - Eliminated 'unknown' bucket sharing problem
   - Added `simpleHash()` for User-Agent fingerprinting

3. **Candidate Session Access Binding** (`src/app/api/roleplay/session/[id]/route.ts`, `src/app/api/roleplay/session/[id]/start/route.ts`)
   - Added session status verification for candidate routes
   - GET `/session/[id]`: Only allows access for states STARTED, IN_PROGRESS, SUBMITTED, UNDER_REVIEW, EVALUATED, PASSED, FAILED
   - POST `/session/[id]/start`: Only allows start/resume for states DRAFT, INVITED, PENDING, STARTED, IN_PROGRESS

### Completed Dependency Fixes (P1)
1. **Dependency Updates**
   - Updated `@types/node` from ^20 to ^22
   - Updated `zod` from ^4.4.3 to ^4.6.6
   - Ran `npm audit fix` - reduced vulnerabilities from 15 to 6
   - Remaining: Next.js critical issues (middleware bypass, RCE in image optimization) and bundled deps - BLOCKED pending major version upgrade decision per project constraints (Next.js 15.2.6 strictly required per AGENTS.md)

### Verification Results
- ✅ All targeted tests pass (roleplay session, session start, candidate access, validate-invite, roleplay order, recruitment, admin roleplays, identity resolver, auth)
- ✅ Build completes successfully (Next.js 15.2.6, Prisma 7.8.0)
- ✅ Lint passes (only pre-existing React hooks warnings)
- ✅ npm audit improved (15 → 6 vulnerabilities)

## Pending Tasks

### P1 - Dependencies & Reproducibility (BLOCKED)
- [ ] **BLOCKED**: Next.js critical vulnerabilities require major version upgrade from 15.2.6 to 15.5.28
  - Project states Next.js 15.2.6 is "Strictly Required (verified by Easypanel success log)" in AGENTS.md
  - Cannot upgrade without verifying compatibility with Easypanel deployment

### P2 - Candidate Flow & Applications
- [ ] Audit `/api/v1/recruitment` and `/postular` routes for security
- [ ] Verify onboarding state machine integrity
- [ ] Check candidate identity unification logic
- [ ] Review roleplay invitation flow for edge cases

### P3 - Data Integrity & Concurrency
- [x] Audit (read-only) executed via `scripts/audit-data-integrity.ts` against production DB:
  - No duplicate emails across recruitment_candidates / interpreters.
  - No orphaned roleplay sessions (interpreter or candidate).
  - No roleplay sessions with both or neither targets (invariant holds).
  - All roleplay session statuses canonical (CANCELLED 3, INVITED 3, STARTED 2); no PENDING/unknown.
  - All emails lowercase across user_profiles, interpreters, recruitment_candidates.
  - No orphaned recruitment applications.
- [ ] **Open finding (expanded)**: `fino@gmail.com` exists as an `rbac_users` row (Auth.js) but has NO `user_profiles` row and NO `interpreters` record. Fully orphaned identity: `resolve-user.ts` cannot link it to an interpreter, so onboarding/roleplay cannot proceed. Requires manual reconciliation (create interpreter + profile, or remove the orphaned rbac_user). Do not auto-create without business data.
- [x] Audit for duplicate users across `rbac_users`: 2 rbac_users, no duplicate emails; 1 rbac_user (fino@gmail.com) orphaned (documented above); 1 user_profile (interpretersfree@gmail.com admin) legitimately has no rbac_user (Supabase admin path).
- [x] Migration safety reviewed: latest migrations (20261012_z_align, 20261019_drop_status, 20261019_unique_scenario) use preflight guards, idempotent DDL (IF NOT EXISTS / DROP IF EXISTS), explicit transactions, and rollback scripts where applicable. Production DB confirms no legacy PENDING rows remain.

### P4 - Architecture & Quality
- [x] Verified roleplay state machine vocabulary consistency (resolve-user.ts vs Prisma enum) — fail-fast on unknown status; removed dead 'PENDING' references from roleplay API routes (validate-invite, validate-invite-by-code, start, session/[id]/start).
- [ ] Audit API authorization patterns

## Next Actions
1. Audit recruitment API routes and candidate flow
2. Run data integrity checks
3. Review roleplay state machine consistency
4. Continue with targeted tests