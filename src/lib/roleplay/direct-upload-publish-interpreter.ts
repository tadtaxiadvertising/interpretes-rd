import 'server-only';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { ROLEPLAY_MAX_SCENARIOS, ROLEPLAY_RESPONSE_MAX_DURATION_SEC } from '@/lib/roleplay-limits';
import { blockingAssignmentStatuses, interpreterAssignmentScope } from '@/lib/roleplay-assignment-ownership';
import { insertOpeningRequiredSession, openingAssignmentEnabled } from './bilingual-opening-assignment';
import { completeRoleplayUploadPublicationInTransaction } from './direct-upload-publication-receipt';
import { loadVerifiedPublication, promoteVerifiedClinicalSlot, type FinalObjectPort } from './direct-upload-promote-slot';

const assignment = z.object({
  interpreterId: z.number().int().positive().safe(),
  scenarios: z.array(z.object({
    title: z.string().trim().min(1).max(200),
    durationLimitSec: z.number().int().positive().max(ROLEPLAY_RESPONSE_MAX_DURATION_SEC).nullable(),
    scriptPrompt: z.string().max(5000).nullable(),
    studioLanguage: z.enum(['en','es','mixed']).nullable(),
  }).strict()).min(1).max(ROLEPLAY_MAX_SCENARIOS),
}).strict();

/**
 * Staged worker/service contract, NOT an HTTP endpoint. The caller must
 * authenticate the administrator, enforce quotas and prove the final-object
 * adapter's immutability/no-overwrite semantics in a Storage pilot.
 * No public URLs, user-supplied object paths or client verification proofs.
 * A failed/ambiguous commit never authorizes deleting copied audio.
 */
export async function publishVerifiedInterpreterRoleplay(db: PrismaClient, port: FinalObjectPort,
  actor: string, requestKey: string, input: unknown) {
  if (!openingAssignmentEnabled() || process.env.ROLEPLAY_DIRECT_UPLOAD_PUBLICATION_ENABLED !== 'true') {
    throw new Error('PUBLICATION_DISABLED');
  }
  const data = assignment.parse(input);
  const initial = await loadVerifiedPublication(db, actor, requestKey);
  if (initial.plans.length !== data.scenarios.length) throw new Error('SCENARIO_COUNT_MISMATCH');
  const final: Awaited<ReturnType<typeof promoteVerifiedClinicalSlot>>[] = [];
  for (const plan of initial.plans) {
    final.push(await promoteVerifiedClinicalSlot(db, port, actor, requestKey, plan.item.order));
  }
  // All network transfers have completed. Serialize with existing creation
  // paths and persist the session, scenarios and receipt atomically.
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'roleplay:interpreter:' + data.interpreterId}, 0))`;
    const current = await loadVerifiedPublication(tx, actor, requestKey);
    if (current.reservation.batchId !== initial.reservation.batchId ||
        current.plans.length !== final.length || current.plans.some((p, i) =>
          p.reference !== final[i].reference || p.item.sha256 !== final[i].sha256 ||
          p.item.sizeBytes !== final[i].sizeBytes)) throw new Error('PUBLICATION_CHANGED');
    const interpreter = await tx.interpreter.findFirst({
      where: { id: data.interpreterId, status: { in: ['Activo','Training','Probation'] } }, select: { id: true },
    });
    if (!interpreter) throw new Error('PARTICIPANT_UNAVAILABLE');
    const conflict = await tx.roleplaySession.findFirst({
      where: { ...interpreterAssignmentScope(interpreter.id), status: { in: blockingAssignmentStatuses(true) } }, select: { id: true },
    });
    if (conflict) throw new Error('PARTICIPANT_HAS_SESSION');
    const session = await insertOpeningRequiredSession(tx, {
      interpreterId: interpreter.id, recruitmentCandidateId: null, status: 'INVITED',
      baseAudioUrl: final[0].reference, baseAudioPath: final[0].reference,
    });
    await tx.roleplaySession.update({
      where: { id: session.id },
      data: { scenarios: { create: data.scenarios.map((scenario, order) => ({
        ...scenario, order, baseAudioUrl: final[order].reference,
      })) } },
    });
    await completeRoleplayUploadPublicationInTransaction(tx, {
      actorUserId: actor, requestKey, reservation: current.reservation, verifiedObjects: current.evidence,
      sessionIds: [session.id], nowMs: Date.now(),
    });
    return { sessionId: session.id, scenarioCount: final.length };
  });
}
