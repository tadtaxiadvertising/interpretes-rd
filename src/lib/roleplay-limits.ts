/**
 * Canonical maximum duration of a single Roleplay response.
 *
 * The recorder, the confirmation action, the admin payload validation and the
 * worker conversion all read this value. Keeping one constant prevents the
 * previous mismatch where the UI/admin allowed longer recordings while FFmpeg
 * silently truncated the converted MP3 at five minutes.
 */
export const ROLEPLAY_RESPONSE_MAX_DURATION_SEC = 300;

/** Maximum scenario count per assigned Roleplay session, including long medical training exercises. */
export const ROLEPLAY_MAX_SCENARIOS = 25;

/** Legacy multipart ingestion: keep count and byte budgets independent of session capacity. */
export const ROLEPLAY_MULTIPART_MAX_SCENARIOS = 25;
export const ROLEPLAY_ADMIN_AUDIO_MAX_BYTES = 15 * 1024 * 1024;
export const ROLEPLAY_MULTIPART_MAX_BYTES = 377 * 1024 * 1024;

/** Existing ZIP/FFmpeg and desktop manifest contracts. */
export const ROLEPLAY_STUDIO_PACKAGE_MAX_SCENARIOS = 25;
export const ROLEPLAY_STUDIO_PACKAGE_MAX_AUDIO_SECONDS = 900;

/** Reservation schema and quota limits, independent of the session count. */
export const ROLEPLAY_DIRECT_UPLOAD_MAX_SLOTS = 25;
export const ROLEPLAY_DIRECT_UPLOAD_BATCH_MAX_BYTES = 375 * 1024 * 1024;
