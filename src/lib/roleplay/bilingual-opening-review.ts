import 'server-only';
import type { Prisma } from '@prisma/client';
import { getBilingualOpeningState } from './bilingual-opening';
import type { OpeningRubric } from './bilingual-opening-rubric';

export type OpeningReview =
  | { state: 'not-required' | 'pending' | 'unavailable' }
  | { state: 'confirmed'; durationSec: number; audioUrl: string | null; rubric?: OpeningRubric };

type ReviewRow = {
  required: boolean;
  sourceAudioPath: string | null;
  durationSec: number | null;
  confirmedAt: Date | null;
  rubric: OpeningRubric | null;
};

/** Caller must authenticate an administrator before reading or signing.
 * No raw object keys or database/provider errors leave this adapter.
 * Staged until the schema and private Storage rollout are verified.
 */
export async function loadBilingualOpeningReview(
  db: Pick<Prisma.TransactionClient, '$queryRaw'>,
  sessionId: string,
  signPath: (path: string) => Promise<string>,
): Promise<OpeningReview> {
  if (process.env.ROLEPLAY_BILINGUAL_OPENING_API_ENABLED !== 'true') return { state: 'not-required' };
  try {
    const [row] = await db.$queryRaw<ReviewRow[]>`
      SELECT s.requires_bilingual_opening AS required,
        o.source_audio_path AS "sourceAudioPath",
        o.duration_sec AS "durationSec", o.confirmed_at AS "confirmedAt",
        CASE WHEN r.session_id IS NOT NULL THEN jsonb_build_object(
          'englishIntro', r.english_intro, 'spanishIntro', r.spanish_intro,
          'professionalRole', r.professional_role, 'consecutiveGuidance', r.consecutive_guidance,
          'clarity', r.clarity, 'notes', r.notes) END AS rubric
      FROM public.roleplay_sessions s
      LEFT JOIN public.roleplay_bilingual_openings o ON o.session_id = s.id
      LEFT JOIN public.roleplay_bilingual_opening_reviews r ON r.session_id = s.id
      WHERE s.id = ${sessionId}
    `;
    if (!row || typeof row.required !== 'boolean') return { state: 'unavailable' };
    if (!row.required) return { state: 'not-required' };
    const recording = typeof row.sourceAudioPath === 'string' && typeof row.durationSec === 'number' && row.confirmedAt
      ? { sourceAudioPath: row.sourceAudioPath, durationSec: row.durationSec, confirmedAt: row.confirmedAt }
      : null;
    if (!recording || getBilingualOpeningState(sessionId, true, recording) !== 'confirmed') return { state: 'pending' };
    let audioUrl: string | null = null;
    try {
      audioUrl = await signPath(recording.sourceAudioPath);
    } catch { /* Keep confirmed state; playback may be temporarily unavailable. */ }
    return { state: 'confirmed', durationSec: recording.durationSec, audioUrl, ...(row.rubric ? { rubric: row.rubric } : {}) };
  } catch {
    return { state: 'unavailable' };
  }
}
