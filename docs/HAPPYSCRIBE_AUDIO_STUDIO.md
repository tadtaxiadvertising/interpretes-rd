# HappyScribe ↔ Audio Studio

## Server configuration

Configure these variables only in the server environment (Easypanel / deployment secrets):

- `HAPPY_SCRIBE_API_TOKEN`: HappyScribe REST API bearer token.
- `HAPPY_SCRIBE_ORGANIZATION_ID`: HappyScribe organization/workspace ID.
- `HAPPY_SCRIBE_MEDIA_PROXY_ENABLED`: optional **server-only** switch; set to `true` to enable transferring full MP3s via the frontend VPS. **Default: off.** Leave unset for the low-bandwidth, privacy-preserving workflow with locally selected audio.

The connected HappyScribe workspace currently reports organization ID `26114416`. Confirm it in HappyScribe before deploying. Never add the bearer token to `.env.example`, client-side variables, source control, browser storage, logs, or request payloads.

## Current workflow

1. An administrator opens **Admin → Roleplays → Audio Studio**.
2. The administrator loads the original audio locally (default), or, **only with the explicit server feature flag enabled**, selects a HappyScribe recording and uses **Importar audio original** to stream its MP3 via the frontend VPS.
3. **Importar desde HappyScribe → Actualizar biblioteca** lists up to 50 recent workspace transcriptions.
4. Select a completed transcription and choose **Importar transcripción**.
5. **Importar audio original** requests the provider's `mp3` export and streams it through an admin-only endpoint (maximum 250 MiB); the signed download URL never reaches the browser. **Importar transcripción** requests an SRT export and returns only bounded subtitle text to the authenticated administrator.
6. Audio Studio reuses its existing SRT/WebVTT parser, review queue, interpreter-exclusion filter, and confirmation flow. SRT exports may omit reliable speaker labels; the administrator must identify the original interpreter and manually verify speaker roles and language before excluding turns or exporting/publishing.

The imported transcript text remains editor-only; it is not copied into participant instructions. The original audio can now be imported directly as MP3 (up to 250 MiB) or loaded locally for larger files. Audio and SRT imports are separate actions so the operator can verify that both belong to the same source. Audio Studio currently retains its existing local editor/draft lifecycle; a persistent source-link audit and direct project/call assignment require a separate data-model integration.

## Security and operational notes

- Both endpoints require the platform's administrator role and use per-user rate limits.
- The API token stays server-side; errors returned to the browser are generic.
- Transcription IDs are validated; export downloads are HTTPS-only and restricted to HappyScribe/AWS hosts.
- SRT downloads are capped at 5 MB and bounded while streaming.
- Direct MP3 imports are **disabled by default**; if explicitly enabled, recordings up to 250 MiB pass through the Next.js frontend server and consume VPS bandwidth. Larger recordings must be loaded locally. The UI does not persist provider signed URLs. This proxy path is not a zero-server-cost or local-only transfer.
- No automatic publication, session creation, QA scoring, or transcript-to-prompt copying occurs.
- The HappyScribe API uses bearer authentication and the documented `GET /transcriptions?organization_id=…`, `GET /transcriptions/:id`, `POST /exports`, and `GET /exports/:id` endpoints.

## Deployment checklist

- [ ] Add both server environment variables in Easypanel for the frontend service; leave `HAPPY_SCRIBE_MEDIA_PROXY_ENABLED` unset unless a maintainer explicitly authorizes the additional bandwidth and privacy implications.
- [ ] Redeploy the frontend service.
- [ ] Verify the administrator can list workspace files.
- [ ] Import a completed SRT against its matching recording (local or directly imported MP3).
- [ ] Confirm the direct-media button is absent and `/api/admin/happyscribe/media` returns 503 by default; if opting in, verify original media over 250 MiB is rejected with a safe fallback message.
- [ ] Verify locked/unfinished transcriptions cannot export audio.
- [ ] Verify the interpreter exclusion and manual speaker/language assignment.
- [ ] Verify non-admin users receive HTTP 403.
- [ ] Verify missing/invalid credentials produce a safe configuration error.
