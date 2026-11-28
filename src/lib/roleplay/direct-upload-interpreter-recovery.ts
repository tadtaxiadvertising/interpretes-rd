import 'server-only';
import type { PrismaClient } from '@prisma/client';
import type { PreparedRoleplayUpload } from './direct-upload-contract';
import type { TrustedRoleplayUploadEvidence } from './direct-upload-publication-gate';
import { fingerprintRoleplayDirectUploadDeclarations, isRoleplayDirectUploadRequestKey } from './direct-upload-reservation-fingerprint';
import { ROLEPLAY_UPLOAD_RESERVATION_TTL_MS } from './direct-upload-reservation';
import { planVerifiedClinicalPublication } from './direct-upload-final-reference';
import { validRoleplayPublicationSessionIds } from './direct-upload-publication-receipt';
import { readOpeningRequirement } from './bilingual-opening-assignment';
import { directInterpreterAssignment, type DirectInterpreterAssignment } from './direct-upload-interpreter-assignment';

import { requireDirectAssignmentBinding } from './direct-upload-assignment-binding';

type Store = Pick<PrismaClient, 'roleplayUploadReservation' | 'roleplaySession' | '$queryRaw'>;

/** Read-only recovery of the receipt committed by the individual publication
 * service. This confirms recorded publication, not present-day Storage
 * availability. Only an authenticated admin can supply the actor argument.
 * Never retry a PUBLISHED row as a new assignment, even after expiry. */
export async function recoverPublishedInterpreterRoleplay(db: Store, actor: string,
  requestKey: string, data: DirectInterpreterAssignment): Promise<{sessionId:string; scenarioCount:number} | null> {
  return recoverPublished(db, actor, requestKey, data);
}

/** A diagnostic lookup does not have the original form. Reconstruct its
 * assignment from the existing session and verify the immutable binding.
 * Never use this reader to initiate publication or send notifications. */
export async function observePublishedInterpreterRoleplay(db: Store, actor: string,
  requestKey: string): Promise<{sessionId:string; scenarioCount:number} | null> {
  return recoverPublished(db, actor, requestKey, null);
}

async function recoverPublished(db: Store, actor: string, requestKey: string,
  original: DirectInterpreterAssignment | null): Promise<{sessionId:string; scenarioCount:number} | null> {
  if (!actor || !isRoleplayDirectUploadRequestKey(requestKey)) throw new Error('INVALID_PUBLICATION_REQUEST');
  const row = await db.roleplayUploadReservation.findUnique({
    where: { actorUserId_requestKey: { actorUserId: actor, requestKey } },
    select: { id:true, actorUserId:true, requestKey:true, status:true, items:true, verifiedObjects:true,
      declarationHash:true, createdAt:true, expiresAt:true, publishedSessionIds:true },
  });
  if (!row || row.actorUserId !== actor || row.requestKey !== requestKey) throw new Error('PUBLICATION_NOT_READY');
  if (original) await requireDirectAssignmentBinding(db,row.id,actor,requestKey,original);
  if (row.status === 'VERIFIED' && Array.isArray(row.publishedSessionIds) && row.publishedSessionIds.length === 0) return null;
  if (row.status !== 'PUBLISHED' || !validRoleplayPublicationSessionIds(row.publishedSessionIds) ||
      row.publishedSessionIds.length !== 1 || !Array.isArray(row.items) || !Array.isArray(row.verifiedObjects)) {
    throw new Error('PUBLICATION_REVIEW_REQUIRED');
  }
  const now = Date.now(), created = row.createdAt.getTime(), expires = row.expiresAt.getTime();
  if (!Number.isSafeInteger(created) || created <= 0 || created > now ||
      expires - created !== ROLEPLAY_UPLOAD_RESERVATION_TTL_MS) throw new Error('PUBLICATION_REVIEW_REQUIRED');
  // Historical evidence only: the expired reservation cannot authorize
  // anything new. Check evidence within its original validity window.
  const plans = planVerifiedClinicalPublication({
    batchId:row.id, ownerUserId:actor, status:'VERIFIED', createdAtMs:created, expiresAtMs:expires,
    items:row.items as unknown as PreparedRoleplayUpload[],
  }, row.verifiedObjects as unknown as TrustedRoleplayUploadEvidence[], actor, Math.min(now,expires-1));
  if (fingerprintRoleplayDirectUploadDeclarations(plans.map(p=>p.item)) !== row.declarationHash ||
      (original && original.scenarios.length !== plans.length)) throw new Error('PUBLICATION_REVIEW_REQUIRED');
  const sessionId = row.publishedSessionIds[0];
  const session = await db.roleplaySession.findUnique({
    where: {id:sessionId},
    select: {id:true, status:true, interpreterId:true, recruitmentCandidateId:true, baseAudioUrl:true, baseAudioPath:true,
      scenarios:{orderBy:{order:'asc'},select:{order:true,title:true,baseAudioUrl:true,durationLimitSec:true,scriptPrompt:true,studioLanguage:true,studioTurn:true,studioSpeaker:true,sourceStartSec:true,sourceEndSec:true}}},
  });
  if (!session) throw new Error('PUBLICATION_REVIEW_REQUIRED');
  const data = original ?? directInterpreterAssignment.parse({
    interpreterId: session.interpreterId,
    scenarios: session.scenarios.map(s => ({
      title: s.title, durationLimitSec: s.durationLimitSec, scriptPrompt: s.scriptPrompt,
      studioLanguage: s.studioLanguage, studioTurn: s.studioTurn, studioSpeaker: s.studioSpeaker,
      sourceStartSec: s.sourceStartSec, sourceEndSec: s.sourceEndSec,
    })),
  });
  if (!original) await requireDirectAssignmentBinding(db,row.id,actor,requestKey,data);
  if (data.scenarios.length !== plans.length || session.id !== sessionId || session.status === 'DRAFT' ||
      session.interpreterId !== data.interpreterId || session.recruitmentCandidateId !== null ||
      session.baseAudioUrl !== plans[0].reference || session.baseAudioPath !== plans[0].reference ||
      session.scenarios.length !== plans.length ||
      session.scenarios.some((scenario,i)=>{
        const expected = data.scenarios[i];
        return scenario.order !== i || scenario.baseAudioUrl !== plans[i].reference ||
          scenario.title !== expected.title || scenario.durationLimitSec !== expected.durationLimitSec ||
          scenario.scriptPrompt !== expected.scriptPrompt || scenario.studioLanguage !== expected.studioLanguage ||
          (scenario.studioTurn ?? null) !== (expected.studioTurn ?? null) ||
          (scenario.studioSpeaker ?? null) !== (expected.studioSpeaker ?? null) ||
          (scenario.sourceStartSec ?? null) !== (expected.sourceStartSec ?? null) ||
          (scenario.sourceEndSec ?? null) !== (expected.sourceEndSec ?? null);
      }) || !(await readOpeningRequirement(db,sessionId))) throw new Error('PUBLICATION_REVIEW_REQUIRED');
  return {sessionId,scenarioCount:plans.length};
}
