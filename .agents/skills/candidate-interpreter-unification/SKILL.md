---
name: candidate-interpreter-unification
description: "Use when unifying candidate and interpreter identities: candidate becomes future interpreter, restricted access until onboarding/roleplay/docs/agreements complete, resume pending work from account, avoid duplicated data, continue roleplay process."
metadata:
  author: interpreters-rd
  version: "0.1.0"
---

# Candidate → Interpreter Unification

## Mission
Treat the candidate as the future interpreter. One account, one interpreter record, progressive unlock. No duplicate data or repeated prompts. Resume pending work from the account.

## Invariants
- Identity order: auth → UserProfile.id → UserProfile.interpreterId → Interpreter.id.
- Email is repair/migration key only; never permanent identity.
- Candidate/interpreter are one record lifecycle: `Candidato` → onboarding → roleplay → `Activo`.
- A roleplay session targets `interpreterId XOR recruitmentCandidateId`.
- Candidate access binds to account + ownership cookie/invitation, never status alone.
- Submission is idempotent and transactional.

## Preflight (before edits)
1. Read `AGENTS.md`, `prisma/schema.prisma`, latest migrations.
2. Inspect target files and direct callers.
3. Run baseline: `npm run test`, `npm run lint`, `npm run build`.

## Implementation phases
1. Resolve candidate identity by email in `src/lib/identity/resolve-user.ts`; query roleplay sessions by candidateId.
2. Create restricted interpreter record at application time (`status='Candidato'`); hire reuses it.
3. Link account registration to existing interpreter by email.
4. Guard production/payroll until hired; allow onboarding/roleplay/docs.
5. Route account to active roleplay session for resumption.
6. Prefill onboarding/banking from candidate data; lock after completion.
7. Keep roleplay create-or-resume and idempotent submit.

## Verification (after edits)
- Targeted tests: resolve-user, roleplay-candidate-access, roleplay-start-candidate, roleplay-order, recruitment, onboarding.
- `npx prisma validate`, `npx prisma generate`, `npm run lint`, `npm run build`.
- Security: missing/wrong cookie, cross-session, double submit/retry, unauthorized audio.
- E2E smoke: apply → account → onboarding → roleplay → submit → hired → dashboard.

## Regression matrix
| Identity | Onboarding | Roleplay | Expected |
|---|---|---|---|
| none | — | — | /login |
| candidate | NOT_STARTED | any | onboarding |
| candidate | IN_PROGRESS | any | resume onboarding |
| candidate | COMPLETED | INVITED/STARTED/IN_PROGRESS | roleplay |
| candidate | COMPLETED | SUBMITTED/UNDER_REVIEW/EVALUATED | dashboard/status |
| hired interpreter | COMPLETED | PASSED/FAILED | dashboard |

## Stop conditions
- Lint/tests/build green.
- No high-severity auth/data issue.
- Diff minimal and explainable.
- External blockers documented.
