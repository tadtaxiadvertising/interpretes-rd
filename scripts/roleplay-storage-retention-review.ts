import type { Client } from 'pg';

type Category='referenced'|'published'|'active-reservation'|'pending-write-claim'|'expired-or-closed'|'missing-reservation'|'unrecognized-path'|'inconsistent-declaration';
const categories:readonly Category[]=['referenced','published','active-reservation','pending-write-claim','expired-or-closed','missing-reservation','unrecognized-path','inconsistent-declaration'];
type Row={category:Category;objects:string;known_bytes:string;unknown_sizes:string};

/** Metadata only. Exact references are a lower bound: other aliases, URLs,
 * pending operations and external clients may still exist. Nothing is safe
 * to delete or refund merely because it appears in an unreferenced class. */
export async function readRoleplayStorageRetentionReview(db:Pick<Client,'query'>){
  const catalog=await db.query<{ready:boolean}>(`
    SELECT to_regclass('public.roleplay_upload_reservations') IS NOT NULL
      AND to_regclass('public.roleplay_final_write_claims') IS NOT NULL
      AND to_regclass('public.roleplay_sessions') IS NOT NULL
      AND to_regclass('public.roleplay_scenarios') IS NOT NULL
      AND to_regclass('public.roleplay_responses') IS NOT NULL AS ready
  `);
  if(catalog.rows.length!==1 || catalog.rows[0]?.ready!==true)
    return {state:'schema-unavailable',categories:[],deletionAuthorized:false as const,refundAuthorized:false as const};
  const result=await db.query<Row>(`
    WITH objects AS (
      SELECT name,CASE WHEN metadata->>'size' ~ '^[0-9]{1,15}$' THEN (metadata->>'size')::numeric END AS bytes,
        regexp_match(name,'^(staging/roleplay|base)/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/(0|[1-9]|1[0-9]|2[0-4])[.](mp3|wav|webm|mp4)$') AS parts
      FROM storage.objects WHERE bucket_id='roleplay-audio-private'
    ), canonical AS (
      SELECT *,CASE WHEN parts IS NOT NULL THEN parts[2]::uuid END AS batch_id,
        CASE WHEN parts IS NOT NULL THEN parts[3]::integer END AS slot_order,
        CASE WHEN parts IS NOT NULL THEN 'private-base/'||parts[2]||'/'||parts[3]||'.'||parts[4] END AS reference
      FROM objects
    ), references_seen AS (
      SELECT base_audio_url AS value FROM public.roleplay_sessions
      UNION ALL SELECT base_audio_path FROM public.roleplay_sessions
      UNION ALL SELECT recorded_audio_url FROM public.roleplay_sessions
      UNION ALL SELECT base_audio_url FROM public.roleplay_scenarios
      UNION ALL SELECT source_audio_url FROM public.roleplay_responses
      UNION ALL SELECT source_audio_path FROM public.roleplay_responses
      UNION ALL SELECT processed_audio_url FROM public.roleplay_responses
      UNION ALL SELECT processed_audio_path FROM public.roleplay_responses
    ), classified AS (
      SELECT o.bytes, CASE
        WHEN EXISTS(SELECT 1 FROM references_seen ref WHERE ref.value=o.name OR ref.value=o.reference
          OR ref.value LIKE '%/'||o.name OR ref.value LIKE '%/'||o.name||'?%') THEN 'referenced'
        WHEN o.parts IS NULL THEN 'unrecognized-path'
        WHEN r.status='PUBLISHED' THEN 'published'
        WHEN EXISTS(SELECT 1 FROM public.roleplay_final_write_claims c WHERE c.reservation_id=o.batch_id AND c.slot_order=o.slot_order) THEN 'pending-write-claim'
        WHEN r.id IS NULL THEN 'missing-reservation'
        WHEN r.items->o.slot_order->>'path' IS DISTINCT FROM ('staging/roleplay/'||o.parts[2]||'/'||o.parts[3]||'.'||o.parts[4])
          OR r.items->o.slot_order->'order' IS DISTINCT FROM to_jsonb(o.slot_order)
          OR o.bytes IS NULL
          OR r.items->o.slot_order->'sizeBytes' IS DISTINCT FROM to_jsonb(o.bytes) THEN 'inconsistent-declaration'
        WHEN r.status IN ('RESERVED','VERIFYING','VERIFIED') AND r.expires_at>CURRENT_TIMESTAMP THEN 'active-reservation'
        WHEN r.status='CANCELLED' OR r.expires_at<=CURRENT_TIMESTAMP THEN 'expired-or-closed'
        ELSE 'inconsistent-declaration'
      END AS category
      FROM canonical o LEFT JOIN public.roleplay_upload_reservations r ON r.id=o.batch_id
    )
    SELECT category,count(*)::text AS objects,coalesce(sum(bytes),0)::text AS known_bytes,
      count(*) FILTER(WHERE bytes IS NULL)::text AS unknown_sizes
    FROM classified GROUP BY category ORDER BY category
  `);
  const seen=new Map<Category,Row>();
  for(const row of result.rows){
    if(!categories.includes(row.category) || seen.has(row.category) ||
       ![row.objects,row.known_bytes,row.unknown_sizes].every(x=>typeof x==='string' && /^(0|[1-9][0-9]{0,29})$/.test(x)) ||
       BigInt(row.unknown_sizes)>BigInt(row.objects)) throw new Error('INVALID_RETENTION_REPORT');
    seen.set(row.category,row);
  }
  return {state:'review-only',categories:categories.map(category=>{
    const r=seen.get(category);
    return {category,objects:r?.objects??'0',knownBytes:r?.known_bytes??'0',unknownSizes:r?.unknown_sizes??'0'};
  }),deletionAuthorized:false as const,refundAuthorized:false as const};
}
