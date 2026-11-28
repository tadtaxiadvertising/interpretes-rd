import type { ReservationCatalogReader } from './direct-upload-reservation-catalog';

type BudgetRow={max_slots:number;allocated_slots:number;charged_slots:number;charge_count:number;
  orphan_charges:number;inconsistent_charges:number;uncharged_reservations:number;
  expired_charges:number;published_charges:number;active_charges:number;closed_charges:number;released_charges:number;released_slots:number;unissued_charges:number;signing_started_charges:number;untracked_charges:number};
const SLOT_BYTES=BigInt(30)*BigInt(1024)*BigInt(1024);
function count(value:unknown):number{
  if(typeof value!=='number' || !Number.isSafeInteger(value) || value<0) throw new Error('INVALID_BUDGET');
  return value;
}

/** Aggregate accounting only, not a Storage inventory or a refund authorization. */
export async function readRoleplayBudgetAccounting(db: ReservationCatalogReader) {
  const catalog=await db.query<{budget:boolean;charges:boolean;reservations:boolean;write_claims:boolean}>(`
    SELECT to_regclass('public.roleplay_direct_upload_budget') IS NOT NULL AS budget,
      to_regclass('public.roleplay_direct_upload_budget_charges') IS NOT NULL AS charges,
      to_regclass('public.roleplay_upload_reservations') IS NOT NULL AS reservations,
      to_regclass('public.roleplay_final_write_claims') IS NOT NULL AS write_claims
  `);
  const c=catalog.rows[0];
  if(catalog.rows.length!==1 || !c || Object.values(c).some(v=>typeof v!=='boolean')) throw new Error('INVALID_CATALOG');
  if(!c.budget || !c.charges || !c.reservations || !c.write_claims){
    return {budget:{state:Object.values(c).every(v=>!v)?'absent':'incomplete'},refundAuthorized:false as const};
  }
  const result=await db.query<BudgetRow>(`
    WITH classified AS (
      SELECT c.slots,r.id IS NULL AS orphan,coalesce(to_jsonb(c)->>'capability_state','UNTRACKED') AS capability_state,
        CASE WHEN r.id IS NULL THEN false ELSE
          r.actor_user_id IS DISTINCT FROM c.actor_user_id OR r.request_key IS DISTINCT FROM c.request_key
          OR jsonb_array_length(r.items) IS DISTINCT FROM c.slots END AS inconsistent,
        r.status,r.expires_at
      FROM public.roleplay_direct_upload_budget_charges c
      LEFT JOIN public.roleplay_upload_reservations r ON r.id=c.reservation_id
    ), summary AS (
      SELECT coalesce(sum(slots) FILTER(WHERE capability_state<>'RELEASED'),0)::int AS charged_slots,count(*)::int AS charge_count,
        count(*) FILTER(WHERE capability_state='RELEASED')::int AS released_charges,
        coalesce(sum(slots) FILTER(WHERE capability_state='RELEASED'),0)::int AS released_slots,
        count(*) FILTER(WHERE capability_state='UNISSUED')::int AS unissued_charges,
        count(*) FILTER(WHERE capability_state='SIGNING_STARTED')::int AS signing_started_charges,
        count(*) FILTER(WHERE capability_state='UNTRACKED')::int AS untracked_charges,
        count(*) FILTER(WHERE orphan AND capability_state<>'RELEASED')::int AS orphan_charges,
        count(*) FILTER(WHERE inconsistent)::int AS inconsistent_charges,
        count(*) FILTER(WHERE capability_state<>'RELEASED' AND NOT orphan AND status IN ('RESERVED','VERIFYING','VERIFIED') AND expires_at<=CURRENT_TIMESTAMP)::int AS expired_charges,
        count(*) FILTER(WHERE capability_state<>'RELEASED' AND NOT orphan AND status='PUBLISHED')::int AS published_charges,
        count(*) FILTER(WHERE capability_state<>'RELEASED' AND NOT orphan AND status IN ('RESERVED','VERIFYING','VERIFIED') AND expires_at>CURRENT_TIMESTAMP)::int AS active_charges,
        count(*) FILTER(WHERE capability_state<>'RELEASED' AND NOT orphan AND status='CANCELLED')::int AS closed_charges
      FROM classified
    )
    SELECT b.max_slots,b.allocated_slots,s.*,
      (SELECT count(*)::int FROM public.roleplay_upload_reservations r
       WHERE NOT EXISTS(SELECT 1 FROM public.roleplay_direct_upload_budget_charges c WHERE c.reservation_id=r.id)) AS uncharged_reservations
    FROM public.roleplay_direct_upload_budget b CROSS JOIN summary s WHERE b.singleton=true
  `);
  const r=result.rows[0];
  if(result.rows.length!==1 || !r) return {budget:{state:'incomplete'},refundAuthorized:false as const};
  const max=count(r.max_slots),allocated=count(r.allocated_slots),charged=count(r.charged_slots),charges=count(r.charge_count);
  const orphan=count(r.orphan_charges),inconsistent=count(r.inconsistent_charges),uncharged=count(r.uncharged_reservations);
  const expired=count(r.expired_charges),published=count(r.published_charges),active=count(r.active_charges),closed=count(r.closed_charges);
  const released=count(r.released_charges),releasedSlots=count(r.released_slots),unissued=count(r.unissued_charges),started=count(r.signing_started_charges),untracked=count(r.untracked_charges);
  const coherent=max<=25 && allocated<=max && charged===allocated && charges-released<=charged &&
    orphan+expired+published+active+closed+released===charges && released+unissued+started+untracked===charges && inconsistent===0 && uncharged===0;
  return {budget:{
    state:coherent?'accounting-consistent':'review-required',maxSlots:max,allocatedSlots:allocated,chargedSlots:charged,
    remainingSlots:coherent?max-allocated:null,reservedWorstCaseBytes:(BigInt(allocated)*SLOT_BYTES).toString(),
    charges,orphanCharges:orphan,inconsistentCharges:inconsistent,unchargedReservations:uncharged,
    expiredCharges:expired,publishedCharges:published,activeCharges:active,closedCharges:closed,
    releasedCharges:released,releasedSlots,unissuedCharges:unissued,signingStartedCharges:started,untrackedCharges:untracked,
  },refundAuthorized:false as const};
}
