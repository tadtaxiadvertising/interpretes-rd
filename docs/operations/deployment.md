# Deployment Operations

## Pipeline

`.github/workflows/deploy.yml` (push/PR to `main`, plus `workflow_dispatch`).

### Job: `validate` (runs on push and PR)
1. `actions/checkout@v4`
2. `setup-node@v4` (Node 22, npm cache)
3. `npm ci --legacy-peer-deps`
4. `npx prisma validate`
5. `npx prisma generate`
6. `npx tsc --noEmit`
7. `npm run lint`
8. `npm test`
9. `npm run build`

### Jobs: `deploy-interpreters` and `deploy-interpreters-api` (main only, `needs: validate`)
POST the Easypanel webhook from secrets `EASYPANEL_WEBHOOK_INTERPRETERS` / `EASYPANEL_WEBHOOK_API`.

**Critical operational note:** if a webhook secret is missing, the job logs a warning and `exit 0` — a **successful no-op**. A green pipeline therefore does **not** prove a deployment happened. Confirm the actual Easypanel deployment (or that deployment is managed outside CI) before declaring production live.

## Build image

- Output mode `standalone`; runtime `node server.js`.
- Docker: multi-stage `node:22-alpine`.
- `next.config.ts`: `serverExternalPackages: ["@prisma/client","prisma","@prisma/adapter-pg","pg"]`, `outputFileTracingIncludes: { "/": ["./prisma/**/*"] }` (Next 15 top-level property).

## Environment variables

- `DATABASE_URL` (Prisma/pg). Must be present at build (Prisma validate) and runtime.
- `AUTH_SECRET`, `AUTH_TRUST_HOST=true` (auto-set in `src/lib/auth-rbac.ts`), `NEXTAUTH_URL`.
- Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

## Pre-deploy checklist

1. `npx prisma validate` + `npx prisma generate`.
2. `npx tsc --noEmit`.
3. `npm run lint`.
4. `npx vitest run --pool=threads --maxWorkers=2`.
5. `npm run build`.
6. Confirm DB migration state matches `prisma/schema.prisma` (this change set adds no migrations).
7. Post-deploy smoke: `/login`, `/postular`, `/roleplays/{id}` fetch, admin roleplay queue.

## Known deployment risks

- Latest observed `main` commit had a failing Vercel status historically; treat deployment as P0 until a green deployment is *verified* (not merely "CI passed").
- Skipped webhook secrets are a silent no-op (see above).
