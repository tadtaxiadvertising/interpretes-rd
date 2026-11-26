import 'server-only';
import type { PrismaClient } from '@prisma/client';
import { directInterpreterAssignment } from './direct-upload-interpreter-assignment';
import { recoverPublishedInterpreterRoleplay } from './direct-upload-interpreter-recovery';
import { blockingAssignmentStatuses, interpreterAssignmentScope } from '@/lib/roleplay-assignment-ownership';
import { insertOpeningRequiredSession, openingAssignmentEnabled } from './bilingual-opening-assignment';
import { completeRoleplayUploadPublicationInTransaction } from './direct-upload-publication-receipt';
import { loadVerifiedPublication, promoteVerifiedClinicalSlot, type FinalObjectPort } from './direct-upload-promote-slot';
import { loadConsolidatedClinicalPublication } from './direct-upload-final-evidence';


/**
 * Staged worker/service contract, NOT an HTTP endpoint. The caller must
 * authenticate the administrator, enforce quotas and prove the final-object
 * adapter's immutability/no-overwrite semantics in a Storage pilot.
 * No public URLs, user-supplied object paths or client verification proofs.
 * A failed/ambiguous commit never authorizes deleting copied audio.
 */
export async function publishVerifiedInterpreterRoleplay(db: PrismaClient, port: FinalObjectPort,
  actor: string, requestKey: string, input: unknown, signal?: AbortSignal) {
  return publishInterpreterRoleplay(db,port,actor,requestKey,input,signal);
}

/** Metadata-only commit from durable final evidence; never a fallback to
 * inline consolidation. Requires the independent immutability pilot gate. */
export async function publishConsolidatedInterpreterRoleplay(db:PrismaClient,
  actor:string,requestKey:string,input:unknown,signal?:AbortSignal) {
  if(process.env.ROLEPLAY_DIRECT_UPLOAD_INCREMENTAL_API_ENABLED!=='true') throw new Error('PUBLICATION_DISABLED');
  return publishInterpreterRoleplay(db,null,actor,requestKey,input,signal);
}

async function publishInterpreterRoleplay(db: PrismaClient, port: FinalObjectPort | null,
  actor: string, requestKey: string, input: unknown, signal?: AbortSignal) {
  if (!openingAssignmentEnabled() || process.env.ROLEPLAY_DIRECT_UPLOAD_PUBLICATION_ENABLED !== 'true') {
    throw new Error('PUBLICATION_DISABLED');
  }
  const data = directInterpreterAssignment.parse(input);
  const recovered = await recoverPublishedInterpreterRoleplay(db, actor, requestKey, data);
  if (recovered) return recovered;
  if (signal?.aborted) throw new Error('PUBLICATION_INTERRUPTED');
  const initial = port ? await loadVerifiedPublication(db, actor, requestKey) : await loadConsolidatedClinicalPublication(db,actor,requestKey);
  if (initial.plans.length !== data.scenarios.length) throw new Error('SCENARIO_COUNT_MISMATCH');
  const final: Awaited<ReturnType<typeof promoteVerifiedClinicalSlot>>[] = [];
  if(port){
    for (const plan of initial.plans) {
      if (signal?.aborted) throw new Error('PUBLICATION_INTERRUPTED');
      final.push(await promoteVerifiedClinicalSlot(db, port, actor, requestKey, plan.item.order));
    }
  } else {
    const consolidated=await loadConsolidatedClinicalPublication(db,actor,requestKey);
    if(consolidated.reservation.batchId!==initial.reservation.batchId) throw new Error('PUBLICATION_CHANGED');
    final.push(...consolidated.final);
  }
  if (signal?.aborted) throw new Error('PUBLICATION_INTERRUPTED');
  // All network transfers have completed. Serialize with existing creation
  // paths and persist the session, scenarios and receipt atomically.
  try {
    return await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'roleplay:interpreter:' + data.interpreterId}, 0))`;
      if (signal?.aborted) throw new Error('PUBLICATION_INTERRUPTED');
      if(!port){
        const locked=await tx.$queryRaw<{id:string}[]>`
          SELECT id::text AS id FROM public.roleplay_upload_reservations
          WHERE id=${initial.reservation.batchId}::uuid AND actor_user_id=${actor}
            AND request_key=${requestKey}::uuid AND status='VERIFIED' AND expires_at>clock_timestamp()
          FOR UPDATE
        `;
        if(locked.length!==1 || locked[0].id!==initial.reservation.batchId) throw new Error('PUBLICATION_CHANGED');
      }
      const current = port ? await loadVerifiedPublication(tx, actor, requestKey) : await loadConsolidatedClinicalPublication(tx,actor,requestKey);
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
      if (signal?.aborted) throw new Error('PUBLICATION_INTERRUPTED');
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
      if (signal?.aborted) throw new Error('PUBLICATION_INTERRUPTED');
      await completeRoleplayUploadPublicationInTransaction(tx, {
        actorUserId: actor, requestKey, reservation: current.reservation, verifiedObjects: current.evidence,
        sessionIds: [session.id], nowMs: Date.now(),
      });
      return { sessionId: session.id, scenarioCount: final.length };
    });
  } catch (error) {
    // The database may have committed even if the reply was lost. Never
    // repeat writes to determine the outcome. Only an exact receipt recovers.
    const replay = await recoverPublishedInterpreterRoleplay(db, actor, requestKey, data).catch(() => null);
    if (replay) return replay;
    throw error;
  }
}
