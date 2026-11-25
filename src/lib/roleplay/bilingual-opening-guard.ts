import 'server-only';
import type { Prisma } from '@prisma/client';
import { getBilingualOpeningState } from './bilingual-opening';

export const OPENING_REQUIRED_MESSAGE = 'Confirma el protocolo de apertura bilingüe antes de continuar.' as const;

type GateRow = {
  required: boolean;
  sourceAudioPath: string | null;
  durationSec: number | null;
  confirmedAt: Date | null;
};

/**
 * Call only after authenticating the session owner. For writes, call in the
 * same transaction as the clinical mutation when available. Requirements
 * must be immutable once a session is assigned; confirmed openings cannot
 * be replaced or removed while a session is active.
 *
 * The rollout flag remains off until the staged schema exists. Do not turn
 * it off once required sessions have been assigned: a future DB constraint
 * must also enforce the invariant independently of runtime configuration.
 */
export async function canProgressPastBilingualOpening(
  db: Pick<Prisma.TransactionClient, '$queryRaw'>,
  sessionId: string,
): Promise<boolean> {
  if (process.env.ROLEPLAY_BILINGUAL_OPENING_API_ENABLED !== 'true') return true;
  const [row] = await db.$queryRaw<GateRow[]>`
    SELECT session.requires_bilingual_opening AS required,
      opening.source_audio_path AS "sourceAudioPath",
      opening.duration_sec AS "durationSec",
      opening.confirmed_at AS "confirmedAt"
    FROM public.roleplay_sessions AS session
    LEFT JOIN public.roleplay_bilingual_openings AS opening ON opening.session_id = session.id
    WHERE session.id = ${sessionId}
  `;
  if (!row || typeof row.required !== 'boolean') return false;
  if (!row.required) return true;
  const recording = typeof row.sourceAudioPath === 'string' && typeof row.durationSec === 'number' && row.confirmedAt
    ? { sourceAudioPath: row.sourceAudioPath, durationSec: row.durationSec, confirmedAt: row.confirmedAt }
    : null;
  return getBilingualOpeningState(sessionId, true, recording) === 'confirmed';
}
