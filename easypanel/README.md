# Easypanel Deployment & Environment Configuration

This directory contains the necessary configuration details for deploying the **Intérpretes RD** on an Easypanel-managed VPS.

> **Easypanel instance**: `rewvid.easypanel.host`  
> **Dominio principal:** `https://interpretes.rd.ibusiness.com.do/` (frontend). Confirma en Easypanel que el dominio esté asignado al servicio `interpreters` y que el certificado TLS esté activo.

---

## Environment Variables

Easypanel requires these variables to be configured in the **Environment** tab of your application settings.

> **Important**: Sensitive vars (`SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `AUTH_SECRET`, `ENCRYPTION_KEY`, `AUDIO_STUDIO_ENCRYPTION_KEY` and the optional HappyScribe API token) must be set as **runtime env vars** in Easypanel, NOT as build args. The Dockerfile runner stage does not inherit builder build-arg env vars.

> **Production freeze (November 2026):** All three deployment jobs in `.github/workflows/deploy.yml` are disabled with `if: ${{ false }}` after an Easypanel incident; validation workflows remain active. Instructions below document the service layout and eventual approved recovery, **not** authorization to trigger deploys, migrations, worker rebuilds or webhooks. Easypanel may also have independent Auto Deploy; verify it is disabled before merging or deploying. See `docs/operations/easypanel-incident-freeze.md`.

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
| `AUDIO_STUDIO_ENCRYPTION_KEY` | **Separate** 32-byte AES-256-GCM key (exactly 64 hexadecimal characters) for HappyScribe tokens saved in Audio Studio. Only the `interpreters` Next.js service needs it. | Runtime only | Store only in Easypanel secret environment |

### 3a. Audio Studio / HappyScribe (Next.js only)

- `AUDIO_STUDIO_ENCRYPTION_KEY` **is not** the HappyScribe API token, and it is not interchangeable with `ENCRYPTION_KEY`. Configure it only on the Next.js `interpreters` service at runtime (never as `NEXT_PUBLIC_*` and never in build arguments).
- `HAPPY_SCRIBE_API_TOKEN` is an optional **runtime-only** fallback if no encrypted token is stored in the panel. Prefer setting the API token in **Administración → Roleplays → Configuración Audio Studio**, where it is stored encrypted. Do **not** copy the master encryption key into that field.
- `HAPPY_SCRIBE_ORGANIZATION_ID` is the numeric organization ID, not a token. It can instead be configured through the administrator panel.
- `HAPPY_SCRIBE_MEDIA_PROXY_ENABLED` should remain `false` by default. SRT transcript import works without the optional MP3 proxy; enabling MP3 proxy can consume significant VPS bandwidth.
- **Preserve existing data:** if there is an encrypted token saved, recover the **original** `AUDIO_STUDIO_ENCRYPTION_KEY` from the secret manager or deployment backups. Replacing it with a new value will not decrypt the saved token. Do not delete or overwrite the ciphertext to bypass this check.
- Only for a fresh installation **without previously encrypted credentials**, generate a cryptographically random 32-byte key. On Windows PowerShell 5.1+, use `$b=New-Object byte[] 32; $r=[System.Security.Cryptography.RandomNumberGenerator]::Create(); try { $r.GetBytes($b); [BitConverter]::ToString($b).Replace('-','').ToLower() } finally { $r.Dispose() }`, then store the output privately in the Easypanel runtime environment and clear local shell history or terminal output where appropriate. If you prefer not to print the value at all, pipe the final hexadecimal expression to `Set-Clipboard` and paste directly into Easypanel; clear the clipboard afterwards. Never paste the key into a chat, issue, log or source file.
- After a **controlled** application of runtime settings to `interpreters`, verify without printing secrets:

  ```bash
  node -e 'const v=process.env.AUDIO_STUDIO_ENCRYPTION_KEY||"";console.log(!v?"AUSENTE":v.length!==64?"LONGITUD_INVALIDA":!/^[a-f0-9]{64}$/i.test(v)?"CARACTERES_INVALIDOS":"CIFRADO_OK")'
  ```

  In Audio Studio use **Recomprobar cifrado en servidor**. A valid 64-character format alone does not prove an existing token can be decrypted. Never restart all three services or rotate a functioning key solely to address an SRT import error. See `docs/operations/happyscribe-encryption-key-recovery.md`.

### 4. Application Configuration

| Variable              | Description                                             | Scope     | Example                                  |
| :-------------------- | :------------------------------------------------------ | :-------- | :--------------------------------------- |
| `NODE_ENV`            | Sets application environment (production/development).  | Runtime   | `production`                             |
| `NEXT_PUBLIC_API_URL` | **SYNC**: Public URL of the backend API service (keep separate from the frontend domain unless API routing is explicitly configured there). | Build+RT | `https://database-interpreters.rewvid.easypanel.host/` |

---

## Services

The project currently documents two public-facing services and adds an optional, private Roleplay worker:

| Service                  | Description                                  | Build                         |
| :----------------------- | :------------------------------------------- | :---------------------------- |
| `interpreters`           | Next.js frontend                             | `Dockerfile`                  |
| `interpreters-api`       | Backend API                                  | `Dockerfile.api`              |
| `roleplay-audio-worker`  | Private, serial FFmpeg conversion worker     | `Dockerfile.worker`           |

The Roleplay worker is not a public HTTP service and does not need a domain. It uses the existing Supabase Storage bucket and PostgreSQL database; it does not require Redis or a paid queue service. The worker image may be validated in CI, but **production deployment is currently disabled in the workflow source with `if: ${{ false }}`**. `ENABLE_ROLEPLAY_AUDIO_WORKER` and the worker webhook cannot override this incident freeze. Any future worker deployment requires a separate, reviewed release plan, verified migration readiness and approval; merely merging to `main` is not authorization.

### Roleplay worker configuration

Create this service only after applying the additive `roleplay_audio_jobs` migration. Configure the same runtime `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `NEXT_PUBLIC_SUPABASE_URL` values used by the application. Do not put service-role keys or database credentials in build arguments.

Start with **one worker replica**. The worker processes one conversion at a time, limits Node's heap to 256 MB, retries failed jobs with backoff, and recovers stale jobs after a worker restart. FFmpeg is a separate native process, so set a container memory limit in Easypanel and monitor the container's total RSS; the Node heap limit does not cap FFmpeg memory.

Do not deploy this worker against production until the migration has been reviewed and applied through the normal release process. The worker must use the same database and Storage project as the frontend.

Each service has its own **webhook URL** for triggering deployments via GitHub Actions.

---

## EasyPanel Deployment Steps

1. **Create Services:** Create the frontend and API services. Add `roleplay-audio-worker` as a private worker service when the Roleplay queue migration is deployed.
2. **Source:** Connect the `interpretes-rd` GitHub repository to each service.
3. **Build:** For `interpreters` use root `Dockerfile` with context `.`; for `interpreters-api` use root `Dockerfile.api` with context `.`. Do not use `interpreters-api/Dockerfile` or set `interpreters-api/` as the build context: that is not the validated production layout.
4. **Env:** Copy variables from the tables above to the **Environment** tab. Mark sensitive vars as runtime-only.
5. **Domains:** Map `interpretes.rd.ibusiness.com.do` to the frontend service `interpreters`; keep the API service on its configured internal/Easypanel endpoint unless a separate API subdomain is provisioned.
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
5. If enabling the worker, add `EASYPANEL_WEBHOOK_ROLEPLAY_WORKER` with the private worker webhook URL and set the repository variable `ENABLE_ROLEPLAY_AUDIO_WORKER=true` under **Settings → Secrets and variables → Actions → Variables → New repository variable**. Do not set it only under **Settings → Environments → production → Environment variables**: environment-scoped variables are not available to the job-level `if:` that gates `deploy-roleplay-audio-worker`, and the job will be skipped.

> Webhook URL format: `https://rewvid.easypanel.host/api/deploy/webhook/<PROJECT_ID>/<SERVICE_ID>`

---

## Monitoring & Logs

- **Resource Usage:** Run `docker stats` in the Easypanel terminal.
- **App Health:** Frontend liveness: `GET /api/health`. Express backend liveness: `GET /health` (must not depend on PostgreSQL). Express backend database readiness: `GET /ready` (read-only probe; may return 503 on DB outage). If Easypanel has a service-level healthcheck override, confirm it uses the intended route before deploying. A healthy `/health` is not proof that the database is ready.
- **Runtime Verification:** Compare the deployed image revision with the intended Git commit, check actual build file/context and confirm no Swarm restart loop. Do not treat a successful webhook HTTP request as deployment confirmation. The public read-only `GET https://interpretes.rd.ibusiness.com.do/api/version` reports `buildId` only when the running Next.js instance has a validated full 40-character `GIT_SHA`; `buildId: null` means provenance is unknown, **not** that the live app matches `main`. For reliable comparisons, provide the commit SHA as immutable build metadata when creating an approved image, not a manually chosen value used to make a running service appear current. Do not trigger a rebuild merely to obtain version metadata. The manual `Verify live Easypanel runtime SHA (read only)` GitHub workflow can compare against the selected `main` SHA with one GET after `EASYPANEL_RELEASE_VERIFY_URL` is configured.
- **Network:** App listens on internal port `3000`.
- **Deploy Logs:** GitHub Actions → workflow runs → check "Deploy interpreters" and "Deploy interpreters-api" jobs.
