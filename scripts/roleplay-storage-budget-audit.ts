import type { Client } from 'pg';

const categories=['legacy','staging','final','other-private','opening','other-buckets'] as const;
type Category=typeof categories[number];
type InventoryRow={category:Category;objects:string;known_bytes:string;unknown_size_objects:string};
type BudgetRow={max_slots:number;allocated_slots:number;charged_slots:number;charge_count:number;
  orphan_charges:number;inconsistent_charges:number;uncharged_reservations:number;
  expired_charges:number;published_charges:number;active_charges:number;closed_charges:number};
const SLOT_BYTES=30n*1024n*1024n;

export const ROLEPLAY_STORAGE_INVENTORY_SQL=`
WITH inventory AS (
 SELECT CASE WHEN bucket_id='roleplay-audio' THEN 'legacy'
   WHEN bucket_id='roleplay-audio-private' AND name LIKE 'staging/roleplay/%' THEN 'staging'
   WHEN bucket_id='roleplay-audio-private' AND name LIKE 'base/%' THEN 'final'
   WHEN bucket_id='roleplay-audio-private' THEN 'other-private'
   WHEN bucket_id='roleplay-opening-private' THEN 'opening' ELSE 'other-buckets' END AS category,
   CASE WHEN metadata->>'size' ~ '^[0-9]{1,15}$' THEN (metadata->>'size')::numeric END AS bytes
 FROM storage.objects
)
SELECT category,count(*)::text AS objects,coalesce(sum(bytes),0)::text AS known_bytes,
 count(*) FILTER(WHERE bytes IS NULL)::text AS unknown_size_objects
FROM inventory GROUP BY category ORDER BY category`;

function unsigned(value:unknown):bigint{
  if(typeof value!=='string' || !/^(0|[1-9][0-9]{0,29})$/.test(value)) throw new Error('INVALID_INVENTORY');
  return BigInt(value);
}
function count(value:unknown):number{
  if(typeof value!=='number' || !Number.isSafeInteger(value) || value<0) throw new Error('INVALID_BUDGET');
  return value;
}

/** Caller must use a read-only, repeatable-read transaction. Aggregate-only:
 * never return object paths, identities, tokens, or individual reservations.
 * Storage metadata is not a provider billing meter or proof of deletion. */
export async function readRoleplayStorageBudgetAudit(db:Pick<Client,'query'>){
  const inventory=await db.query<InventoryRow>(ROLEPLAY_STORAGE_INVENTORY_SQL);
  const observed=new Map<Category,InventoryRow>();
  let known=0n,unknown=0n,objects=0n;
  for(const row of inventory.rows){
    if(!categories.includes(row.category) || observed.has(row.category)) throw new Error('INVALID_INVENTORY');
    const n=unsigned(row.objects),b=unsigned(row.known_bytes),u=unsigned(row.unknown_size_objects);
    if(u>n || n===0n) throw new Error('INVALID_INVENTORY');
    observed.set(row.category,row);objects+=n;known+=b;unknown+=u;
  }
  const totals={
    objects:objects.toString(),knownBytes:known.toString(),unknownSizeObjects:unknown.toString(),
    byCategory:categories.map(category=>{
      const r=observed.get(category);
      return {category,objects:r?.objects??'0',knownBytes:r?.known_bytes??'0',unknownSizeObjects:r?.unknown_size_objects??'0'};
    }),
  };
  const catalog=await db.query<{budget:boolean;charges:boolean;reservations:boolean;write_claims:boolean}>(`
    SELECT to_regclass('public.roleplay_direct_upload_budget') IS NOT NULL AS budget,
      to_regclass('public.roleplay_direct_upload_budget_charges') IS NOT NULL AS charges,
      to_regclass('public.roleplay_upload_reservations') IS NOT NULL AS reservations,
      to_regclass('public.roleplay_final_write_claims') IS NOT NULL AS write_claims
  `);
  const c=catalog.rows[0];
  if(catalog.rows.length!==1 || !c || Object.values(c).some(v=>typeof v!=='boolean')) throw new Error('INVALID_CATALOG');
  if(!c.budget || !c.charges || !c.reservations || !c.write_claims){
    return {inventory:totals,budget:{state:Object.values(c).every(v=>!v)?'absent':'incomplete'},refundAuthorized:false as const};
  }
  const result=await db.query<BudgetRow>(`
    WITH classified AS (
      SELECT c.slots,r.id IS NULL AS orphan,
        CASE WHEN r.id IS NULL THEN false ELSE
          r.actor_user_id IS DISTINCT FROM c.actor_user_id OR r.request_key IS DISTINCT FROM c.request_key
          OR jsonb_array_length(r.items) IS DISTINCT FROM c.slots END AS inconsistent,
        r.status,r.expires_at
      FROM public.roleplay_direct_upload_budget_charges c
      LEFT JOIN public.roleplay_upload_reservations r ON r.id=c.reservation_id
    ), summary AS (
      SELECT coalesce(sum(slots),0)::int AS charged_slots,count(*)::int AS charge_count,
        count(*) FILTER(WHERE orphan)::int AS orphan_charges,
        count(*) FILTER(WHERE inconsistent)::int AS inconsistent_charges,
        count(*) FILTER(WHERE NOT orphan AND status IN ('RESERVED','VERIFYING','VERIFIED') AND expires_at<=CURRENT_TIMESTAMP)::int AS expired_charges,
        count(*) FILTER(WHERE NOT orphan AND status='PUBLISHED')::int AS published_charges,
        count(*) FILTER(WHERE NOT orphan AND status IN ('RESERVED','VERIFYING','VERIFIED') AND expires_at>CURRENT_TIMESTAMP)::int AS active_charges,
        count(*) FILTER(WHERE NOT orphan AND status='CANCELLED')::int AS closed_charges
      FROM classified
    )
    SELECT b.max_slots,b.allocated_slots,s.*,
      (SELECT count(*)::int FROM public.roleplay_upload_reservations r
       WHERE NOT EXISTS(SELECT 1 FROM public.roleplay_direct_upload_budget_charges c WHERE c.reservation_id=r.id)) AS uncharged_reservations
    FROM public.roleplay_direct_upload_budget b CROSS JOIN summary s WHERE b.singleton=true
  `);
  const r=result.rows[0];
  if(result.rows.length!==1 || !r) return {inventory:totals,budget:{state:'incomplete'},refundAuthorized:false as const};
  const max=count(r.max_slots),allocated=count(r.allocated_slots),charged=count(r.charged_slots),charges=count(r.charge_count);
  const orphan=count(r.orphan_charges),inconsistent=count(r.inconsistent_charges),uncharged=count(r.uncharged_reservations);
  const expired=count(r.expired_charges),published=count(r.published_charges),active=count(r.active_charges),closed=count(r.closed_charges);
  const coherent=max<=25 && allocated<=max && charged===allocated && charges<=charged &&
    orphan+expired+published+active+closed===charges && inconsistent===0 && uncharged===0;
  return {inventory:totals,budget:{
    state:coherent?'accounting-consistent':'review-required',maxSlots:max,allocatedSlots:allocated,chargedSlots:charged,
    remainingSlots:coherent?max-allocated:null,reservedWorstCaseBytes:(BigInt(allocated)*SLOT_BYTES).toString(),
    charges,orphanCharges:orphan,inconsistentCharges:inconsistent,unchargedReservations:uncharged,
    expiredCharges:expired,publishedCharges:published,activeCharges:active,closedCharges:closed,
  },refundAuthorized:false as const};
}
