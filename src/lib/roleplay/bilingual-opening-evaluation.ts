import 'server-only';
import type { Prisma } from '@prisma/client';
import { getBilingualOpeningState } from './bilingual-opening';
import { parseOpeningRubric, type OpeningRubric } from './bilingual-opening-rubric';
import { roleplayBusinessError } from './action-errors';

type Tx = Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw'>;
type Evidence = { required: boolean; sourceAudioPath: string | null; durationSec: number | null; confirmedAt: Date | null };

export async function prepareOpeningEvaluation(tx: Tx, sessionId: string, form: FormData): Promise<OpeningRubric | null> {
  if (process.env.ROLEPLAY_BILINGUAL_OPENING_API_ENABLED !== 'true') return null;
  const [row] = await tx.$queryRaw<Evidence[]>`
    SELECT s.requires_bilingual_opening AS required, o.source_audio_path AS "sourceAudioPath",
      o.duration_sec AS "durationSec", o.confirmed_at AS "confirmedAt"
    FROM public.roleplay_sessions s LEFT JOIN public.roleplay_bilingual_openings o ON o.session_id = s.id
    WHERE s.id = ${sessionId}
  `;
  if (!row || typeof row.required !== 'boolean') throw new Error('Opening review schema unavailable');
  if (!row.required) return null;
  const recording = typeof row.sourceAudioPath === 'string' && typeof row.durationSec === 'number' && row.confirmedAt
    ? { sourceAudioPath: row.sourceAudioPath, durationSec: row.durationSec, confirmedAt: row.confirmedAt } : null;
  if (getBilingualOpeningState(sessionId, true, recording) !== 'confirmed') {
    throw roleplayBusinessError('Confirma el protocolo de apertura bilingüe antes de continuar.');
  }
  const rubric = parseOpeningRubric(form);
  if (!rubric) throw roleplayBusinessError('Completa los cinco criterios de apertura bilingüe.');
  return rubric;
}

/** Call only inside the canonical QA transaction after its atomic claim. */
export async function persistOpeningEvaluation(tx: Tx, sessionId: string, reviewerId: string, rubric: OpeningRubric) {
  const count = await tx.$executeRaw`
    INSERT INTO public.roleplay_bilingual_opening_reviews
      (session_id, reviewer_id, english_intro, spanish_intro, professional_role, consecutive_guidance, clarity, notes)
    VALUES (${sessionId}, ${reviewerId}, ${rubric.englishIntro}, ${rubric.spanishIntro},
      ${rubric.professionalRole}, ${rubric.consecutiveGuidance}, ${rubric.clarity}, ${rubric.notes})
  `;
  if (count !== 1) throw new Error('Opening review not persisted');
}
