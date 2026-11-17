# HappyScribe ↔ Audio Studio

## Server configuration

Configure these variables only in the server environment (Easypanel / deployment secrets):

- `HAPPY_SCRIBE_API_TOKEN`: HappyScribe REST API bearer token.
- `HAPPY_SCRIBE_ORGANIZATION_ID`: HappyScribe organization/workspace ID.

The connected HappyScribe workspace currently reports organization ID `26114416`. Confirm it in HappyScribe before deploying. Never add the bearer token to `.env.example`, client-side variables, source control, browser storage, logs, or request payloads.

## Current workflow

1. An administrator opens **Admin → Roleplays → Audio Studio**.
2. The administrator loads the corresponding original audio locally.
3. **Importar desde HappyScribe → Actualizar biblioteca** lists up to 50 recent workspace transcriptions.
4. Select a completed transcription and choose **Importar transcripción**.
5. The server requests an SRT export from HappyScribe and returns only the bounded subtitle text to the authenticated administrator.
6. Audio Studio reuses its existing SRT/WebVTT parser, review queue, interpreter-exclusion filter, and confirmation flow. The operator then assigns speaker role and language to each intervention before exporting/publishing.

The imported transcript text remains editor-only; it is not copied into participant instructions. The source audio is not downloaded by this integration; load the matching original recording into Audio Studio first. A future phase can add a separately consented media import and persistent source-link audit.

## Security and operational notes

- Both endpoints require the platform's administrator role and use per-user rate limits.
- The API token stays server-side; errors returned to the browser are generic.
- Transcription IDs are validated; export downloads are HTTPS-only and restricted to HappyScribe/AWS hosts.
- SRT downloads are capped at 5 MB and bounded while streaming.
- No automatic publication, session creation, QA scoring, or transcript-to-prompt copying occurs.
- The HappyScribe API uses bearer authentication and the documented `GET /transcriptions?organization_id=…`, `GET /transcriptions/:id`, `POST /exports`, and `GET /exports/:id` endpoints.

## Deployment checklist

- [ ] Add both server environment variables in Easypanel for the frontend service.
- [ ] Redeploy the frontend service.
- [ ] Verify the administrator can list workspace files.
- [ ] Import a completed SRT against its matching local recording.
- [ ] Verify the interpreter exclusion and manual speaker/language assignment.
- [ ] Verify non-admin users receive HTTP 403.
- [ ] Verify missing/invalid credentials produce a safe configuration error.
