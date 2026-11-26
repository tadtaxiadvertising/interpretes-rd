import 'server-only';
import type { Prisma, PrismaClient } from '@prisma/client';
import { ROLEPLAY_MAX_SCENARIOS } from '@/lib/roleplay-limits';
import { loadVerifiedPublication, promoteVerifiedClinicalSlot, type FinalObjectPort } from './direct-upload-promote-slot';
import { isRoleplayDirectUploadRequestKey } from './direct-upload-reservation-fingerprint';

type Store = Pick<Prisma.TransactionClient, '$queryRaw' | 'roleplayUploadReservation'>;
type Publication = Awaited<ReturnType<typeof loadVerifiedPublication>>;
type Evidence = {order:number; reference:string; sizeBytes:number; sha256:string; verifiedAt:Date};

async function readEvidence(db:Store, publication:Publication, now:number) {
  const {reservation,plans,evidence} = publication;
  const rows = await db.$queryRaw<Evidence[]>`
    SELECT slot_order AS "order", reference, size_bytes AS "sizeBytes", sha256, verified_at AS "verifiedAt"
    FROM public.roleplay_final_upload_evidence
    WHERE reservation_id = ${reservation.batchId}::uuid
    ORDER BY slot_order
    LIMIT ${ROLEPLAY_MAX_SCENARIOS + 1}
  `;
  if (!Array.isArray(rows) || rows.length>plans.length || rows.some((row,i)=>{
    const p=plans[i];
    const at=row.verifiedAt instanceof Date ? row.verifiedAt.getTime():NaN;
    return row.order!==i || row.reference!==p.reference || row.sizeBytes!==p.item.sizeBytes ||
      row.sha256!==p.item.sha256 || !Number.isSafeInteger(at) ||
      at<evidence[i].verifiedAtMs || at>=reservation.expiresAtMs || at>now;
  })) throw new Error('FINAL_EVIDENCE_INVALID');
  return rows;
}

function progress(verified:number,total:number) {
  return {verifiedCount:verified,total,complete:verified===total};
}

/** Only for a trusted administrative service, behind disabled-by-default
 * rollout gates. Historical evidence assumes proven immutable final objects.
 * No Storage work takes place inside a database transaction. Never accept
 * destination paths or verification evidence from the browser. */
export async function consolidateDirectUploadSlot(db:PrismaClient, port:FinalObjectPort,
  actor:string, requestKey:string, order:number, signal?:AbortSignal) {
  if(!actor || !isRoleplayDirectUploadRequestKey(requestKey) ||
    !Number.isSafeInteger(order) || order<0 || order>=ROLEPLAY_MAX_SCENARIOS) throw new Error('INVALID_FINAL_SLOT');
  const check=()=>{if(signal?.aborted) throw new Error('PUBLICATION_INTERRUPTED');};
  check();
  const initial=await loadVerifiedPublication(db,actor,requestKey);
  const prior=await readEvidence(db,initial,Date.now());
  check();
  if(order<prior.length) return progress(prior.length,initial.plans.length);
  if(order!==prior.length || order>=initial.plans.length) throw new Error('FINAL_SLOT_OUT_OF_ORDER');
  const final=await promoteVerifiedClinicalSlot(db,port,actor,requestKey,order);
  const verifiedAt=new Date();
  check();
  return db.$transaction(async tx=>{
    // Serialize only the metadata commit, not the network transfer.
    const locked=await tx.$queryRaw<{id:string}[]>`
      SELECT id::text AS id FROM public.roleplay_upload_reservations
      WHERE id=${initial.reservation.batchId}::uuid AND actor_user_id=${actor}
        AND request_key=${requestKey}::uuid AND status='VERIFIED'
        AND expires_at>clock_timestamp()
      FOR UPDATE
    `;
    if(locked.length!==1 || locked[0].id!==initial.reservation.batchId) throw new Error('FINAL_RESERVATION_CHANGED');
    const current=await loadVerifiedPublication(tx,actor,requestKey);
    if(current.reservation.batchId!==initial.reservation.batchId ||
      current.reservation.createdAtMs!==initial.reservation.createdAtMs ||
      current.reservation.expiresAtMs!==initial.reservation.expiresAtMs ||
      current.plans.length!==initial.plans.length ||
      current.plans.some((p,i)=>p.reference!==initial.plans[i].reference ||
        p.item.sizeBytes!==initial.plans[i].item.sizeBytes || p.item.sha256!==initial.plans[i].item.sha256 ||
        current.evidence[i].verifiedAtMs!==initial.evidence[i].verifiedAtMs)) throw new Error('FINAL_RESERVATION_CHANGED');
    const rows=await readEvidence(tx,current,Date.now());
    check();
    if(order<rows.length) return progress(rows.length,current.plans.length);
    if(order!==rows.length || final.order!==order ||
      final.reference!==current.plans[order].reference ||
      final.sha256!==current.plans[order].item.sha256 ||
      final.sizeBytes!==current.plans[order].item.sizeBytes ||
      verifiedAt.getTime()<current.evidence[order].verifiedAtMs ||
      verifiedAt.getTime()>=current.reservation.expiresAtMs) throw new Error('FINAL_EVIDENCE_INVALID');
    const inserted=await tx.$queryRaw<{order:number}[]>`
      INSERT INTO public.roleplay_final_upload_evidence
        (reservation_id,slot_order,reference,size_bytes,sha256,verified_at)
      SELECT id,${order}::integer,${final.reference},${final.sizeBytes}::integer,${final.sha256},${verifiedAt}
      FROM public.roleplay_upload_reservations
      WHERE id=${current.reservation.batchId}::uuid AND actor_user_id=${actor}
        AND request_key=${requestKey}::uuid AND status='VERIFIED' AND expires_at>clock_timestamp()
      ON CONFLICT (reservation_id,slot_order) DO NOTHING
      RETURNING slot_order AS "order"
    `;
    if(inserted.length!==1 || inserted[0].order!==order) throw new Error('FINAL_EVIDENCE_NOT_COMMITTED');
    check();
    return progress(order+1,current.plans.length);
  });
}

/** Trusted transaction reader for a future publication path. The caller must
 * lock the reservation and enforce the immutable-object pilot guarantees.
 * This validates all canonical final references, not current live bytes. */
export async function loadConsolidatedClinicalPublication(db:Store,actor:string,requestKey:string) {
  const publication=await loadVerifiedPublication(db,actor,requestKey);
  const rows=await readEvidence(db,publication,Date.now());
  if(rows.length!==publication.plans.length) throw new Error('FINAL_CONSOLIDATION_INCOMPLETE');
  return {...publication,final:rows.map(({order,reference,sizeBytes,sha256})=>({order,reference,sizeBytes,sha256}))};
}
