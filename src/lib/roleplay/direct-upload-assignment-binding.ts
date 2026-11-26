import 'server-only';
import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { directInterpreterAssignment } from './direct-upload-interpreter-assignment';

export function fingerprintDirectInterpreterAssignment(input:unknown){
  const data=directInterpreterAssignment.parse(input);
  return createHash('sha256').update(JSON.stringify({
    version:1,interpreterId:data.interpreterId,
    scenarios:data.scenarios.map(s=>({
      title:s.title,durationLimitSec:s.durationLimitSec,scriptPrompt:s.scriptPrompt,studioLanguage:s.studioLanguage,
      studioTurn:s.studioTurn??null,studioSpeaker:s.studioSpeaker??null,
      sourceStartSec:s.sourceStartSec??null,sourceEndSec:s.sourceEndSec??null,
    })),
  })).digest('hex');
}

/** The charge is bound to the reservation's actor/key and becomes immutable
 * before the first signing call. Never bind during publication or recovery. */
export async function requireDirectAssignmentBinding(db:Pick<PrismaClient,'$queryRaw'>,
  batchId:string,actor:string,requestKey:string,input:unknown){
  const digest=fingerprintDirectInterpreterAssignment(input);
  const rows=await db.$queryRaw<{matched:boolean}[]>`
    SELECT true AS matched FROM public.roleplay_direct_upload_budget_charges
    WHERE reservation_id=${batchId}::uuid AND actor_user_id=${actor}
      AND request_key=${requestKey}::uuid AND capability_state='SIGNING_STARTED'
      AND assignment_hash=${digest}
  `;
  if(rows.length!==1 || rows[0].matched!==true) throw new Error('PUBLICATION_REVIEW_REQUIRED');
}
