import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';

type Tx = Pick<Prisma.TransactionClient, '$queryRaw'>;
type NewSession = {
  interpreterId: number | null;
  recruitmentCandidateId: number | null;
  baseAudioUrl: string;
  baseAudioPath?: string | null;
  status: 'DRAFT' | 'INVITED' | 'STARTED';
};

/** Assignment is a separate rollout step. Never enable until schema, private
 * Storage policies, clinical playback and the full participant flow are verified. */
export function openingAssignmentEnabled(): boolean {
  return process.env.ROLEPLAY_BILINGUAL_OPENING_API_ENABLED === 'true' &&
    process.env.ROLEPLAY_BILINGUAL_OPENING_UI_ENABLED === 'true' &&
    process.env.ROLEPLAY_BILINGUAL_OPENING_ASSIGNMENT_ENABLED === 'true';
}

export async function readOpeningRequirement(tx: Tx, sessionId: string): Promise<boolean> {
  const [row] = await tx.$queryRaw<{ required: boolean }[]>`
    SELECT requires_bilingual_opening AS required FROM public.roleplay_sessions WHERE id = ${sessionId}
  `;
  if (!row || typeof row.required !== 'boolean') throw new Error('Opening requirement unavailable');
  return row.required;
}

/** The staged column is intentionally not in Prisma's generated model yet.
 * Insert only the required session here; caller persists scenarios/invitation
 * in the existing transaction. Other sessions retain their normal Prisma path. */
export async function insertOpeningRequiredSession(tx: Tx, data: NewSession) {
  if (!openingAssignmentEnabled()) throw new Error('Opening assignment unavailable');
  if ((data.interpreterId === null) === (data.recruitmentCandidateId === null)) {
    throw new Error('Invalid opening session owner');
  }
  const id = randomUUID();
  const [row] = await tx.$queryRaw<{ id: string; updatedAt: Date }[]>`
    INSERT INTO public.roleplay_sessions
      (id, interpreter_id, recruitment_candidate_id, base_audio_url, base_audio_path,
       status, current_scenario_index, created_at, updated_at, review_priority, requires_bilingual_opening)
    VALUES (${id}, ${data.interpreterId}, ${data.recruitmentCandidateId}, ${data.baseAudioUrl},
      ${data.baseAudioPath ?? null}, ${data.status}::public."RoleplayStatus", 0,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0, true)
    RETURNING id, updated_at AS "updatedAt"
  `;
  if (!row || row.id !== id || !(row.updatedAt instanceof Date)) throw new Error('Opening session insert failed');
  return { ...row, status: data.status };
}
