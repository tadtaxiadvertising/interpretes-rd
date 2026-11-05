# Deployment Operations

## Pipeline and safety boundary

`.github/workflows/deploy.yml` validates pushes and PRs to `main`, and supports `workflow_dispatch`. Deploy jobs run only on `refs/heads/main` in the `production` environment.

The workflow concurrency group is scoped to the ref and uses `cancel-in-progress: false`. An active main run retains the group through validation, migration and both webhooks. Another main run cannot interleave these stages. GitHub may replace an older pending run with a newer one; this is not a FIFO release queue. This protection does not coordinate manual SQL, other workflows, or an already running version of the old workflow.

### Validation on isolated PostgreSQL

The `validate` job uses disposable PostgreSQL 16 credentials, never production secrets. It runs Prisma validation/generation, database preparation, critical and operational migration checks, a real read-only deployment preflight, TypeScript checks (application/audit/scripts), lint, unit tests, a production build and isolated Playwright E2E.

The operational migration check reconstructs the old schema inside a rollback-only transaction. It checks per-client account-name uniqueness and preserves account IDs, ownership, rates, assignments and history through migration and reapplication. Same-name accounts belonging to different clients remain distinct by account ID. A duplicate within the same client is rejected. An unassigned legacy account remains addressable by its original ID.

### Production sequence

1. Install the migration dependencies.
2. Run `npx tsx scripts/deployment-preflight.ts` with **all three** required secrets: `DIRECT_URL`, `EASYPANEL_WEBHOOK_INTERPRETERS`, `EASYPANEL_WEBHOOK_API`.
3. Before constructing a database client, reject missing/blank secrets, malformed URLs, whitespace/control characters and recognizable pooler configurations. Error messages contain fixed variable names and guidance, never URL values or raw driver errors. No webhook is called by preflight.
4. With the explicit `DIRECT_URL` only, connect using bounded connection/query timeouts. Run a read-only transaction with `LIMIT 0` checks for the existing account/client prerequisites, then roll back and close. No user rows are read. There is no fallback to `DATABASE_URL`.
5. Only after preflight succeeds, retain the existing `DIRECT_URL` guard and apply `prisma/migrations/20261105150000_account_names_per_client/migration.sql` with `--apply --transaction`.
6. Only after migration succeeds, POST the interpreters webhook. A missing/invalid webhook or an unsuccessful response fails the job.
7. The API job depends on both validation and the interpreters job. Only then POST the API webhook.

A successful webhook response confirms acceptance of a request, not completion or health of an Easypanel deployment. Confirm both services in Easypanel and run production smoke checks before claiming production is verified. Preflight confirms connectivity and prerequisites, not production identity, backup readiness, all DDL permissions or future webhook availability. Credentials can change after preflight; subsequent failures still stop the pipeline.

## Required secret configuration — issue #194

Audit on **2026-11-05** found `DIRECT_URL` absent from both repository and `production` environment secret names. Both webhook secrets existed at repository scope. Codex Cloud did not start the work because its connector reported a usage limit. Main `119eb58116f3356abf123a9f6b0b24638af6b8fe` passed validation but failed the migration guard: [run 42102367398](https://github.com/tadtaxiadvertising/interpretes-rd/actions/runs/42102367398). No production schema inspection or migration was performed for this change.

An authorized administrator must:

1. In the production database dashboard, confirm the intended project/database and direct migration credential. Confirm a restorable backup and audit existing `(client_id, name)` conflicts before applying a unique index. Never substitute a test database URL.
2. Open GitHub **Settings > Environments > production > Environment secrets** and add `DIRECT_URL` through GitHub's secret UI. Do not paste it into source, PRs, issue comments, terminal output or screenshots. Verify the existing webhook secrets are available to this environment and that environment protections permit the reviewed main workflow to access them.
3. Use a complete direct `postgres://` or `postgresql://` URL with username, password and database. Percent-encode special characters. Do not use Supabase transaction pooling on port 6543, a `*.pooler.supabase.com` endpoint or `pgbouncer=true`. Recognizing known pooler forms cannot detect every custom proxy: verify the target in the database dashboard. Direct Supabase endpoints may need IPv6 or the IPv4 add-on; resolve runner network access without silently substituting a pooled/test URL. See [Supabase connection guidance](https://supabase.com/docs/guides/database/connecting-to-postgres).
4. After review/merge, use the **new reviewed main revision**. Do not rerun an older workflow that lacks the all-secret preflight. The read-only check must succeed before the transactional migration can run. Investigate failures privately; do not enable shell tracing or dump environment variables.
5. Confirm the actual production schema: `accounts_client_id_name_key` is valid and unique on `(client_id, name)`; the global `accounts_name_key` constraint/index is absent. Confirm prior client-directory migrations already exist. Preserve existing account IDs and foreign keys.
6. Confirm frontend deployment and then backend deployment in Easypanel, plus application health. Test account selection by ID, independent rates/assignments/history for two clients using the same account name, and duplicate rejection within a client. Coordinate any production test records explicitly with the data owner; isolated fixtures are never production data.

**External blockers remain:** administrator secret configuration; verified production target/network/backup; successful reviewed main preflight and migration; inspection of the actual production indexes; completed Easypanel deployments and production smoke evidence. Passing PR CI does not close these blockers or issue #194. This PR must not auto-merge or trigger production manually.

## Migration retry and recovery

The SQL uses `IF EXISTS` / `IF NOT EXISTS` and is reapplied in isolated regression checks. The production runner uses one transaction so a conflict does not leave the old global index partially removed. Idempotent SQL does not prove that an existing index has the correct definition: inspect its columns, uniqueness and validity in production.

On failure, stop both deployments and investigate. Coordinate any manual migration separately from CI. If migration fails, its transaction rolls back; never bypass the guard or delete rows to make it pass. If migration commits but a later webhook fails, verify the schema and deployed revision before a controlled retry. Once distinct clients have same-name accounts, restoring global name uniqueness is not a safe automatic rollback. Use an approved backup/restore or a reviewed forward fix with the data owner.

## Build and application environment

- Next.js output is `standalone`; runtime is `node server.js`; Docker uses `node:22-alpine`.
- `DATABASE_URL` serves the application. Prisma CLI config can fall back to it, but the production deployment preflight requires `DIRECT_URL` explicitly.
- Application runtime also needs the established Auth.js, encryption and Supabase settings. Do not copy production values into the isolated CI job.
- The `production` GitHub environment is required for both deploy jobs. Validate on a PR first; keep deployment status separate from validation status.
