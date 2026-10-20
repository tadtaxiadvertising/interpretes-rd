# Security Audit

## Authentication & authorization model

- `validateAction(requiredRole?)` (`src/lib/auth/actions.ts`) is the server-action guard. No-arg = any authenticated actor; role arg enforces RBAC.
- `CurrentActor` (`src/lib/auth/current-actor.ts`) carries `provider, userId, email, role, interpreterId, profileId`.
- `resolveCurrentIdentity()` is the canonical identity source.

## Ownership / access gates verified

| Surface | Gate | Result |
|---|---|---|
| `confirmRoleplayResponse` | interpreter → owning `interpreterId`; candidate → opaque `roleplay_session` cookie equals session id | ENFORCED + tested |
| `submitRoleplayResponse` | same as above | ENFORCED |
| `GET /api/roleplay/session/[id]` | `resolveCurrentIdentity` (401 if none) + `checkSessionAccess`; candidate branch requires cookie + status `STARTED/IN_PROGRESS` | ENFORCED |
| `/api/roleplay/convert-audio` | identity + cookie match + candidate status `STARTED/IN_PROGRESS` | ENFORCED + tested |
| `/api/admin/roleplays` (POST/GET) | `validateAction('admin')` | ENFORCED |
| `startCandidateRoleplay` (new) | `validateAction()` (any authenticated) + candidate bound by account email | ENFORCED + tested |

### Invariant: existence of an id is not authorization

Candidate sessions require the opaque, server-issued `roleplay_session` cookie in addition to authentication. `startCandidateRoleplay` issues it; the invite/start flow (`/api/roleplay/start`) issues it for token-based access. `GET` also suppresses `baseAudioUrl`/`recordedAudioUrl` and blanks scenario `baseAudioUrl` when the candidate token is not validated and unused.

## Candidate-role correction

Candidates are role `interpreter` (`normalizeRbacRole`), so `validateAction('interpreter')` does **not** block a candidate account. The earlier hypothesis that candidate roleplay endpoints were broken by a role gate was **disproven**. Protection is by ownership/cookie, not by role.

## Open-redirect hardening (new)

`src/lib/auth/safe-next.ts#safeNextPath` normalizes the `?next=` value used by `login`/`register`. It rejects: empty/oversized, non-`/`-prefixed, protocol-relative `//`, backslashes, any `:`, and control characters. This prevents `?next=//evil.com` and `?next=https://evil.com` redirects.

## Request-body hygiene

`withSecurity` wrappers must `req.clone()` before reading a body so downstream handlers still receive it (documented repo rule).

## Secrets

No secrets are introduced or logged by this change set. Audio conversion relies on `SUPABASE_SERVICE_ROLE_KEY` server-side only.

## Residual risks

- Roleplay audio is delivered as signed URLs; `source_audio_path` is not persisted by the confirm path, so re-signing after expiry is not possible for those responses.
- `roleplay_service.saveResponse` duplicate-upsert bug (latent, test-only reachability) could create duplicate response rows if ever wired to production.
