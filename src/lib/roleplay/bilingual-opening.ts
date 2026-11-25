import { ROLEPLAY_RESPONSE_MAX_DURATION_SEC } from '@/lib/roleplay-limits';

export const BILINGUAL_OPENING_BUCKET = 'roleplay-opening-private';
export const BILINGUAL_OPENING_MAX_BYTES = 15 * 1024 * 1024;
export const BILINGUAL_OPENING_MIME_TYPES = ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg'] as const;

export type BilingualOpeningState = 'not-required' | 'pending' | 'confirmed';

export function isCanonicalBilingualOpeningPath(path: string, sessionId: string): boolean {
  const match = /^openings\/([^/]+)\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(webm|mp4|ogg|mp3)$/.exec(path);
  return Boolean(match && match[0] === path && match[1] === sessionId && /^[a-zA-Z0-9_-]{1,100}$/.test(sessionId));
}

/**
 * Future workflow gate. Only call with trusted database rows after ownership
 * checks; this is not proof of Storage contents or of spoken-language quality.
 * A required session with missing/invalid evidence remains pending.
 */
export function getBilingualOpeningState(
  sessionId: string,
  required: boolean,
  recording: { sourceAudioPath: string; durationSec: number; confirmedAt: Date } | null | undefined,
): BilingualOpeningState {
  if (!required) return 'not-required';
  if (!recording || !isCanonicalBilingualOpeningPath(recording.sourceAudioPath, sessionId) ||
      !Number.isInteger(recording.durationSec) || recording.durationSec < 1 ||
      recording.durationSec > ROLEPLAY_RESPONSE_MAX_DURATION_SEC ||
      !(recording.confirmedAt instanceof Date) || !Number.isFinite(recording.confirmedAt.getTime())) return 'pending';
  return 'confirmed';
}
