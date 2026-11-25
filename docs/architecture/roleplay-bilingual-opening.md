# Bilingual medical opening — staged contract

The interpreter addresses both parties in English and Spanish before the first clinical clip. This is a separate participant recording, not a translation of the first doctor's audio, not a source clip, and not an extra item in the 25-scenario limit.

This change is intentionally inactive. The staged SQL is outside Prisma migrations. No current session query, creation route or recording action reads its fields. The new component and pure validation contract are available for later integration, with no live migration required for this PR.

## Required integration before enabling

1. Validate the staged schema against a disposable database, reconcile Prisma, and deploy the additive schema before runtime queries. Existing sessions remain exempt.
2. Snapshot the opening requirement when creating a new medical session, including library assignments. Do not infer it on an existing session from title, role or language metadata.
3. Issue private, scoped signed uploads only for the authorized session owner with a valid invitation, active status, required opening and no confirmed recording. Use a server-generated opening path; never reuse a clinical scenario ID or its response path.
4. Confirm the actual uploaded object and duration; use a unique session record and transactional state checks to handle concurrent or retried confirmations. Do not trust a browser URL or metadata as proof of audio. Refresh playback URLs on authorized reads only.
5. Restore the opening state from the database on reload. Mount RoleplayOpening before the first clinical clip when pending. The UI must not advance after a failed confirmation.
6. Enforce the opening requirement at server-side clinical recording authorization, confirmation, assessment and final submission gates. No client-only gate or bypass through a direct API call. Do not change legacy session order or assessment progress.
7. Give QA access to the separate recording, with its own opening evaluation criteria. A confirmed object proves a persisted recording, not that both languages were spoken correctly.
8. Cover legacy sessions, candidate/interpreter ownership, invite expiry, cross-session paths, retry/concurrency, reload, QA playback, cleanup and both themes in automated tests.

Do not enable the feature or apply the staged SQL to production until schema and runtime verification are complete.

## Staged participant API

`GET /api/roleplay/session/[id]/opening` returns only the opening state. `POST` accepts a strict JSON command: `authorize` with `mimeType` and `size`, or `confirm` with the reserved object `path`. The server verifies identity, candidate cookie, eligibility, invitation and ownership before invoking the private service. No client-supplied duration is accepted. Responses are private and non-cacheable. Request bodies are bounded to 2 KiB, audio to 15 MiB, and admission is limited per actor and ingress IP (process-local; a shared limiter is still needed for a multi-instance global quota).

The route returns 404 by default. `ROLEPLAY_BILINGUAL_OPENING_API_ENABLED` is a server-only rollout flag, not a public client flag. **Do not enable it yet**: verify the staged SQL in disposable PostgreSQL, integrate the participant workflow and all progression guards, verify Storage policies and QA playback, and address abandoned reservation cleanup and retry UX. Existing sessions and production schema are unchanged by this PR.

## Staged clinical progression guards

With the API rollout flag enabled, the server checks the persisted opening before preparing a clinical response, issuing a clinical upload token, confirming clinical audio, accepting self-assessment or submitting the session. The legacy multipart audio endpoint checks before uploading as well. Missing or invalid required evidence blocks progress; query failures do not authorize it. These checks do not yet redact clinical source playback URLs from invitation/session APIs. Before assigning any required session, add playback restrictions and refresh the client session after confirmation, enforce the invariant at the database layer regardless of feature flags, and verify the complete flow in PostgreSQL and Storage. Do not disable the API flag after assigning required sessions without a safe recovery plan. No rollout or production migration is performed here.

## Dedicated private opening storage

All future opening recordings use `roleplay-opening-private`, not the historical `roleplay-audio` bucket. The server checks current bucket metadata before minting upload or playback capabilities: private visibility, a 15 MiB file limit, exactly audio/webm, audio/mp4, audio/ogg and audio/mpeg. The browser uses the same bucket and normalized content type. Missing or unsafe metadata fails closed; no automatic public-bucket fallback or bucket reconfiguration occurs. No existing audio is moved or deleted.

Provision the bucket through the supported Storage API or dashboard during rollout. Bucket metadata alone cannot prove object policy isolation: inspect existing `storage.objects` policies, ensure no direct browser access to the new bucket, and test signed upload, anonymous denial, cross-user denial and authorized signed playback in an isolated environment. Do not enable required sessions before these checks and the schema/creation path are ready. See https://supabase.com/docs/guides/storage/buckets/fundamentals .

## Storage preparation command

Run `npm run roleplay:opening-storage -- --check-only` in an explicitly selected environment with existing server credentials. This is read-only. To create only the missing dedicated bucket, use `npm run roleplay:opening-storage -- --create-missing`. The command never updates or deletes an existing bucket, never migrates audio, and never enables feature flags. It checks metadata after creation and reports only a coarse status. Use the supported Storage API rather than directly modifying storage tables. Run policy isolation tests separately before enabling the workflow. Never run against production automatically during CI.

## Staged assignment

The main admin creation form defaults to bilingual opening when `ROLEPLAY_BILINGUAL_OPENING_ASSIGNMENT_ENABLED`, `ROLEPLAY_BILINGUAL_OPENING_API_ENABLED`, and `ROLEPLAY_BILINGUAL_OPENING_UI_ENABLED` are all true. An admin may deselect it for non-opening exercises. Library sources that already require opening retain that requirement; a mismatching existing draft is rejected, never modified. New required sessions are inserted with the immutable requirement inside the existing assignment transaction. Candidate QA retries preserve the previous attempt's requirement. Old callers without the field keep the legacy creation path; no historical sessions are backfilled. The older standalone createRoleplaySession action is not an opening-enabled assignment path.

**Do not enable these flags yet.** The exact insert is covered by the isolated PostgreSQL fixture; production schema, private opening bucket, direct object policy checks, clinical audio privacy, abandoned object cleanup, and end-to-end pilot validation must be completed before publishing required sessions. If the API flag is disabled after required sessions exist, the application cannot reliably recover their workflow. Do not use flag rollback as a substitute for a recovery plan.

## Safe discard and retired object inventory

The authenticated participant can submit `discard` with the exact pending path. The same session lock and ownership checks protect it; a confirmed opening, different reservation or active verification lease cannot be discarded. An already absent reservation is an idempotent success. The participant can then record again without waiting for the old reservation to expire. PostgreSQL records replaced/deleted reservation keys in a private retirement ledger that survives session deletion; retired keys cannot be reused. A minimum grace period precedes cleanup eligibility. No audio is deleted by this path. The read-only inventory command `npx tsx --tsconfig tsconfig.scripts.json scripts/inspect-roleplay-opening-retired-paths.ts --check-only` reports counts only, excluding current reservations and confirmed openings from eligibility. Actual removal still requires a bounded, separately verified Storage cleanup process that accounts for outstanding upload capabilities and late uploads; do not interpret the counts as deletion authorization. No automatic production job or activation is added.

## Bounded retired audio cleanup

`npm run roleplay:opening-cleanup -- --check-only` previews up to ten existing eligible objects; `--apply` explicitly removes only those eligible objects through the Storage API, after matching hosted Supabase project endpoints, checking private bucket metadata, taking a session advisory lock, rechecking the exact retired path against active reservations and confirmed openings, and waiting at least 24 hours after retirement. A successful deletion must be followed by a metadata absence check. Stop on uncertain outcomes; rerun the preview before retrying. Historical/cascaded session deletions are not cleanup-authorized, and retired keys remain fenced. The command refuses unrecognized/custom endpoints and transaction poolers. Do not schedule or enable removal until the complete schema and policy rollout and an isolated Storage integration test succeed. No automatic worker or production deletion is configured.

## Private clinical playback (staged)

The existing `roleplay-audio` bucket is public. New admin multipart assignments requiring opening now target the existing `roleplay-audio-private` bucket only, using immutable `private-base/<uuid>/<order>.<ext>` database references. Participant/invitation and QA playback resolve these through fresh private-bucket checks and short-lived signed URLs. No fallback to public storage. Public legacy library templates cannot be assigned with required opening; uploading an already published clip again cannot revoke its original public copy. Private library indexing/reuse and historical response migration still require separate work. No old audio is moved, no visibility changes are made, and no opening flags are enabled. Run full CI and an isolated Storage pilot before activation; audit all legacy entry points and response audio separately.
