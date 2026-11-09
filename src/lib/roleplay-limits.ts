/**
 * Canonical maximum duration of a single Roleplay response.
 *
 * The recorder, the confirmation action, the admin payload validation and the
 * worker conversion all read this value. Keeping one constant prevents the
 * previous mismatch where the UI/admin allowed longer recordings while FFmpeg
 * silently truncated the converted MP3 at five minutes.
 */
export const ROLEPLAY_RESPONSE_MAX_DURATION_SEC = 300;
