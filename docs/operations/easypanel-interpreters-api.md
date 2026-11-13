# Easypanel — `interpreters-api` (Express backend)

## Deployment contract

The repository has **two different applications**. The web frontend is the root Next.js application (`Dockerfile`), while `interpreters-api` is a separate Express API compiled from `interpreters-api/src/server.ts` (`Dockerfile.api`).

| Setting | `interpreters-api` | Frontend |
| --- | --- | --- |
| Dockerfile | `Dockerfile.api` | `Dockerfile` |
| Build context/path | repository root (`.`) | repository root (`.`) |
| Image command | `node dist/server.js` | `node server.js` |
| Internal port | `3000` | `3000` |
| Container health URL | `/health` | `/api/health` |
| Health JSON service | `interpreters-api` | `free-interpreters-os` |

**Do not set the backend's build context to `interpreters-api/`**. `Dockerfile.api` copies the `interpreters-api/` subdirectory *and* the root `prisma/` folder. All paths are relative to repository root.

## Evidence motivating this runbook

In the 2026-11-13 Easypanel build for the service named `interpreters-api`, logs showed the root `Dockerfile` invoking `next build` rather than building the Express backend. That is a service configuration mismatch, even though GitHub Actions reported success after sending the deployment webhook.

The service also logged plaintext secret-bearing `--build-arg` parameters. **Never attach or copy these command lines to an issue, PR or support ticket.** Track configuration and rotation under #263. The Server Actions key lifecycle is tracked under #198.

## Safe correction sequence

1. Restrict access to deployment logs and build caches containing sensitive command-line arguments. Capture **redacted** evidence of the current service config and current health response. Prepare rollback before making changes.
2. Ensure the GitHub CI check **Build dedicated interpreters-api backend image** passes (`docker build -f Dockerfile.api .` with isolated CI data). Do not deploy the backend image from an unvalidated commit.
3. Inspect Easypanel's `interpreters-api` service **Source / Build** settings. Set **build path/context to repository root** and **Dockerfile path to `Dockerfile.api`**. Keep the frontend service on root `Dockerfile`.
4. In the backend's **runtime variables**, set `DATABASE_URL`, `JWT_SECRET`, `NODE_ENV=production`, `PORT=3000`, and a restrictive `CORS_ORIGINS` list of trusted web origins. Use protected runtime values, not Docker build arguments. Never expose runtime secrets as `NEXT_PUBLIC_*`.
5. Review the GitHub production webhook mapping (`EASYPANEL_WEBHOOK_API`) to ensure it targets this backend service, without displaying or logging its value. A 2xx webhook response proves only **deployment was triggered**, not that the container is serving the correct application.
6. Deploy the validated backend image. Check container logs for **Interpreters API running** (Express) and verify `GET /health` returns HTTP 200 with `service: "interpreters-api"` and `status: "ok"`. If it returns `free-interpreters-os` or only `/api/health` works, the frontend image is probably still attached to the backend service.
7. Test a protected API route without credentials; verify it rejects unauthenticated access. Then test an authorized request in a controlled environment. Confirm frontend API routing/CORS and error logs before considering the deployment healthy.
8. If the image does not start or dependencies break, **rollback the previous known-good service release**; do not mutate production tables as a workaround. Review the isolated Docker build result and startup logs.
9. Rotate exposed credentials only through the provider/Easypanel and coordinated client updates; treat `ENCRYPTION_KEY` separately because existing encrypted data may depend on it.

## Operational verification checklist

- [ ] `Dockerfile.api` builds successfully in isolated CI.
- [ ] Easypanel backend service points at repository root + `Dockerfile.api`.
- [ ] No confidential credentials are passed as build args or printed in build logs.
- [ ] Backend runtime receives protected variables; CORS allowlist is configured.
- [ ] Health returns HTTP 200, `service=interpreters-api`, `status=ok`.
- [ ] A non-authenticated protected route fails closed; an authorized call succeeds.
- [ ] Frontend service continues using its own `Dockerfile` and `/api/health`.
- [ ] Rollback point and redacted deployment evidence have been recorded.

## Scope

This runbook is non-destructive. It does not change Easypanel configuration, generate keys, rotate secrets, run migrations, or imply production is healthy. Those outcomes require service-owner access and live verification.
