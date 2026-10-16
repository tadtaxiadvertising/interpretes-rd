# Data Model Audit

Source of truth: `prisma/schema.prisma`. Enums/models relevant to roleplay and recruitment.

## RoleplaySession (`roleplay_sessions`)

Key fields: `id`, `interpreterId Int?`, `recruitmentCandidateId Int?`, `baseAudioUrl String`, `recordedAudioUrl String?`, `status RoleplayStatus @default(DRAFT)`, `evaluatorId String?`, `qaScoreId Int? @unique`, timestamps (`submittedAt`, `evaluatedAt`, `createdAt`, `completedAt`, `updatedAt`, `reviewStartedAt`), `currentScenarioIndex Int @default(0)`, `reviewPriority Int? @default(0)`.

Relations: `interpreter`, `recruitmentCandidate`, `qaScore`, `access RoleplayAccess?`, `scenarios RoleplayScenario[]`.

**Invariant (documented, not DB-enforced):** a session targets exactly one of `interpreterId` XOR `recruitmentCandidateId`. There is no check constraint; callers validate.

## RoleplayStatus

`DRAFT, INVITED, STARTED, IN_PROGRESS, SUBMITTED, UNDER_REVIEW, EVALUATED, PASSED, FAILED, EXPIRED, CANCELLED`.

**Vocabulary hazard:** several code paths compare `status` against the legacy literal `'PENDING'` (e.g. `validateInviteToken`, `submitRoleplayResponse`, `confirmRoleplayResponse`, `/api/roleplay/start`). `PENDING` is **not** in the enum, so it can never be produced by a Prisma write. It only matters for legacy rows. Prisma `where.in` arrays must not include `PENDING` (it fails type-check), which is why `ACTIVE_ROLEPLAY_STATUSES` excludes it.

## RoleplayAccess (`roleplay_access`)

`id`, `sessionId`, `tokenHash @unique`, `inviteCode String? @unique`, `expiresAt`, `usedAt?`, `validatedAt?`, `startedAt?`, `createdAt`. `sessionId` is `@unique` (one access row per session). Lifecycle: `validate → start → consume`; validation must not consume (`usedAt` stays null until consumed).

## RoleplayScenario (`roleplay_scenarios`)

`id (cuid)`, `sessionId`, `order Int`, `title`, `baseAudioUrl String`, `durationLimitSec Int?`, `scriptPrompt String?`, `expectedKeys String[]`, `createdAt`. Index `[sessionId, order]`. Cascades on session delete.

## RoleplayResponse (`roleplay_responses`)

`id (cuid)`, `scenarioId`, `sourceAudioUrl String?`, `sourceAudioPath String?`, `processedAudioUrl String?`, `processedAudioPath String?`, `audioStatus AudioStatus @default(UPLOADED)`, `processingError?`, `durationSec Int?`, `selfScore Json?`, `selfNotes String?`, `submittedAt?`, `createdAt`. Cascades on scenario delete.

**Important:** `scenarioId` has **no** unique constraint, and `id` is a cuid (not the scenario id). Any `upsert({ where: { id: scenarioId } })` is a bug. The repaired confirm path uses `findFirst({ where: { scenarioId } })` then `update`/`create`.

## RecruitmentCandidate (`recruitment_candidates`)

`id`, `name`, `email @unique`, contact fields, `englishLevel`, `speedtestMbps`, `status @default("Aplicante")`, recruitment dates, `resultRoleplay Int?`, `createdAt`, `updatedAt`. Relation `roleplaySessions`, `applications`.

Email is the join key used by `startCandidateRoleplay()` (normalized `toLowerCase().trim()`), consistent with the identity invariant that email is a migration/repair key.

## Migration discipline

- New constraints require auditing existing rows first.
- Prefer existing unique constraints/indexes; avoid speculative indexes.
- The repair change set adds **no** schema changes and **no** migrations.
