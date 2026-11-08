# Easypanel Deployment & Environment Configuration

This directory contains the necessary configuration details for deploying the **Free Interpreters OS** on an Easypanel-managed VPS.

> **Easypanel instance**: `rewvid.easypanel.host`  
> **Custom domains** (`freeinterpreters.com`) are not yet configured — services are accessible via Easypanel subdomains.

---

## Environment Variables

Easypanel requires these variables to be configured in the **Environment** tab of your application settings.

> **Important**: Sensitive vars (`SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `AUTH_SECRET`, `ENCRYPTION_KEY`) must be set as **runtime env vars** in Easypanel, NOT as build args. The Dockerfile runner stage does not inherit builder build-arg env vars.

### 1. Supabase Client Configuration

| Variable                        | Description                                     | Scope     | Example                               |
| :------------------------------ | :---------------------------------------------- | :-------- | :------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | REST API endpoint for your Supabase project.    | Build+RT  | `https://your-id.supabase.co`         |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anonymous public key for client-side requests.  | Build+RT  | `eyJhbGciOiJIUz...`                   |
| `SUPABASE_SERVICE_ROLE_KEY`     | Service role secret key for admin operations.   | Runtime   | `eyJhbGciOiJIUz...`                   |

> The anon key must start with `eyJ` — placeholder keys like `sb_publishable_...` are **invalid** and return HTTP 401.

### 2. Database Configuration (Prisma)

| Variable       | Description                                              | Scope     | Example                                                |
| :------------- | :------------------------------------------------------- | :-------- | :----------------------------------------------------- |
| `DATABASE_URL` | **RUNTIME**: Points to Pooler (port 6543).               | Runtime   | `postgresql://postgres.[id]:[pass]@pooler.com:6543/db` |
| `DIRECT_URL`   | **MIGRATIONS**: Direct connection (port 5432).           | Runtime   | `postgresql://postgres.[id]:[pass]@direct.com:5432/db` |

### 3. Auth & Security Configuration

| Variable          | Description                                    | Scope     | Example                                             |
| :---------------- | :--------------------------------------------- | :-------- | :-------------------------------------------------- |
| `AUTH_SECRET`     | NextAuth/Auth.js session encryption key.       | Runtime   | `a1b2c3d4e5f6...`                                   |
| `ENCRYPTION_KEY`  | 32-byte hex key for data encryption.           | Runtime   | `0123456789abcdef0123456789abcdef...`               |

### 4. Application Configuration

| Variable              | Description                                             | Scope     | Example                                  |
| :-------------------- | :------------------------------------------------------ | :-------- | :--------------------------------------- |
| `NODE_ENV`            | Sets application environment (production/development).  | Runtime   | `production`                             |
| `NEXT_PUBLIC_API_URL` | **SYNC**: Public URL of the backend API service.        | Build+RT  | `https://database-interpreters.rewvid.easypanel.host/` |

---

## Services

The project currently documents two public-facing services and adds an optional, private Roleplay worker:

| Service                  | Description                                  | Build                         |
| :----------------------- | :------------------------------------------- | :---------------------------- |
| `interpreters`           | Next.js frontend                             | `Dockerfile`                  |
| `interpreters-api`       | Backend API                                  | `Dockerfile.api`              |
| `roleplay-audio-worker`  | Private, serial FFmpeg conversion worker     | `Dockerfile.worker`           |

The Roleplay worker is not a public HTTP service and does not need a domain. It uses the existing Supabase Storage bucket and PostgreSQL database; it does not require Redis or a paid queue service. The image is built by CI on every main push, but production deployment is opt-in and only runs when the GitHub production environment variable `ENABLE_ROLEPLAY_AUDIO_WORKER` is set to `true` and the `EASYPANEL_WEBHOOK_ROLEPLAY_WORKER` secret is configured. Until enabled, the worker is not automatically deployed.

### Roleplay worker configuration

Create this service only after applying the additive `roleplay_audio_jobs` migration. Configure the same runtime `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `NEXT_PUBLIC_SUPABASE_URL` values used by the application. Do not put service-role keys or database credentials in build arguments.

Start with **one worker replica**. The worker processes one conversion at a time, limits Node's heap to 256 MB, retries failed jobs with backoff, and recovers stale jobs after a worker restart. FFmpeg is a separate native process, so set a container memory limit in Easypanel and monitor the container's total RSS; the Node heap limit does not cap FFmpeg memory.

Do not deploy this worker against production until the migration has been reviewed and applied through the normal release process. The worker must use the same database and Storage project as the frontend.

Each service has its own **webhook URL** for triggering deployments via GitHub Actions.

---

## EasyPanel Deployment Steps

1. **Create Services:** Create the frontend and API services. Add `roleplay-audio-worker` as a private worker service when the Roleplay queue migration is deployed.
2. **Source:** Connect the `free-interpreters-os` GitHub repository to each service.
3. **Build:** Use `Dockerfile` at root with context `.`.
4. **Env:** Copy variables from the tables above to the **Environment** tab. Mark sensitive vars as runtime-only.
5. **Domains:** Map your public domain (e.g., `interpreters.rewvid.easypanel.host`) or configure custom domains later.
6. **Webhooks:** Copy webhook URLs from each service's Settings → Webhook section. Store them as GitHub Secrets (see below).
7. **Deploy:** Execute initial deployment. For the worker, set its build file to `Dockerfile.worker` (context `.`), configure runtime `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`, set one replica, and keep it private with no domain.
8. Enable automatic worker deployment only after the service has started successfully once and the production migrations are confirmed applied.

---

## GitHub Secrets for Auto-Deploy

The `.github/workflows/deploy.yml` workflow requires the two application secrets below. The private worker webhook is required only when the optional worker deployment is enabled:

| Secret Name                      | Value                                                       | How to get it                                            |
| :------------------------------- | :---------------------------------------------------------- | :------------------------------------------------------- |
| `EASYPANEL_WEBHOOK_INTERPRETERS` | Webhook URL for `interpreters` service                      | Easypanel → `interpreters` service → Settings → Webhook  |
| `EASYPANEL_WEBHOOK_API`          | Webhook URL for `interpreters-api` service                  | Easypanel → `interpreters-api` service → Settings → Webhook |
| `EASYPANEL_WEBHOOK_ROLEPLAY_WORKER` | Webhook URL for `roleplay-audio-worker` service (optional) | Easypanel → `roleplay-audio-worker` service → Settings → Webhook |

### Setting Secrets via `gh` CLI

```bash
# 1. Authenticate first:
gh auth login

# 2. Set each secret (paste the webhook URL when prompted):
gh secret set EASYPANEL_WEBHOOK_INTERPRETERS -R tadtaxiadvertising/interpretes-rd
gh secret set EASYPANEL_WEBHOOK_API -R tadtaxiadvertising/interpretes-rd
# Only after creating and configuring the private worker service:
gh secret set EASYPANEL_WEBHOOK_ROLEPLAY_WORKER -R tadtaxiadvertising/interpretes-rd

# 3. Verify secrets exist:
gh secret list -R tadtaxiadvertising/interpretes-rd
```

### Setting Secrets via GitHub UI

1. Go to `github.com/tadtaxiadvertising/interpretes-rd` → **Settings** → **Secrets and variables** → **Actions**.
2. Click **New repository secret**.
3. Add `EASYPANEL_WEBHOOK_INTERPRETERS` with the interpreters webhook URL.
4. Add `EASYPANEL_WEBHOOK_API` with the interpreters-api webhook URL.
5. If enabling the worker, add `EASYPANEL_WEBHOOK_ROLEPLAY_WORKER` with the private worker webhook URL and set **Settings → Environments → production → Environment variables**: `ENABLE_ROLEPLAY_AUDIO_WORKER=true`.

> Webhook URL format: `https://rewvid.easypanel.host/api/deploy/webhook/<PROJECT_ID>/<SERVICE_ID>`

---

## Monitoring & Logs

- **Resource Usage:** Run `docker stats` in the Easypanel terminal.
- **App Health:** Check the "Logs" tab for real-time output.
- **Network:** App listens on internal port `3000`.
- **Deploy Logs:** GitHub Actions → workflow runs → check "Deploy interpreters" and "Deploy interpreters-api" jobs.
