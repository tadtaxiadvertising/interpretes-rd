# QA v1 score contract — safe rollout and read-only production check

**Scope:** `POST /api/v1/qa` only. This is a legacy API in which input dimensions
are already-weighted points capped at **20/40/20/10/10**. In contrast,
`QAEngine` and the canonical Server Actions use per-dimension **0–100
percentages**. Roleplay QA is a different rubric and is not affected.

## Correction

- Convert each legacy contribution to `contribution / maximum * 100`
  before writing it to `qa_scores`. Its columns hold values in the
  0–100 range, consistent with the canonical Server Actions.
- Compute the expected total from these rounded, canonical dimensions.
  A perfect legacy scorecard now has `100`, not the former erroneous `26`.
- Critical error forces an expected total of `0`.
- Within one Prisma database transaction, verify the supplied production log
  belongs to the selected interpreter; insert the score; compare the
  **returned database total** with the expected total. If a PostgreSQL
  trigger overwrites the result inconsistently, throw within the transaction
  to roll back the new QA score rather than issuing a misleading evaluation.
- There are **no schema migrations, writes to historical QA, changes to
  payroll, or live-data migrations** in this PR.

## Read-only diagnostics on the actual production DB

**First confirm the actual project/database associated with the deployed
Easypanel service.** Do not assume an unrelated Supabase project is the
same database. Use a read-only DBA session and do not publish row-level QA,
patient, employee, or connection data.

The following statement checks only trigger metadata:

```sql
SELECT tg.tgname AS trigger_name,
       p.proname AS function_name,
       pg_get_triggerdef(tg.oid) AS trigger_definition,
       tg.tgenabled AS enabled
FROM pg_trigger AS tg
JOIN pg_proc AS p ON p.oid = tg.tgfoid
WHERE tg.tgrelid = to_regclass('public.qa_scores')
  AND NOT tg.tgisinternal
ORDER BY tg.tgname;
```

A second **aggregate-only**, read-only check can identify *candidates* for
historical review (counts do not prove incorrect results, because previous
input scales or trigger behavior could differ):

```sql
SELECT COUNT(*) AS records,
       COUNT(*) FILTER (
         WHERE critical_error
           AND total_score IS DISTINCT FROM 0
       ) AS critical_error_nonzero_candidates,
       COUNT(*) FILTER (
         WHERE NOT critical_error
           AND total_score IS NOT NULL
           AND ABS(total_score - ROUND(
             COALESCE(protocol_score, 0) * 0.20 +
             COALESCE(interpretation_score, 0) * 0.40 +
             COALESCE(language_score, 0) * 0.20 +
             COALESCE(service_score, 0) * 0.10 +
             COALESCE(technical_score, 0) * 0.10, 2
           )) > 0.01
       ) AS weighted_total_mismatch_candidates
FROM public.qa_scores;
```

Review whether an enabled trigger forces the total score, and whether it
supports critical errors, without recording secrets or private user data.
Do not assume the migration files reflect the live trigger state.

## Release acceptance

1. TypeScript, ESLint, Vitest, Next.js build and E2E must pass for the **latest
   PR HEAD**. No merge on pending/failed checks.
2. On staging with synthetic data, verify perfect, partial, zero, critical,
   missing log, wrong owner and DB-trigger mismatch. A trigger mismatch
   must result in a rolled-back create.
3. Confirm the live trigger in the correct DB with the read-only query.
4. Keep historical scores unchanged until a separate authorized
   reconciliation and retention review; do not auto-correct or re-score
   invoices and payroll.
