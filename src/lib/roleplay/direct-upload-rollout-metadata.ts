import type { ReservationCatalogReader } from './direct-upload-reservation-catalog';
import { OPENING_ASSIGNMENT_FLAGS, DIRECT_UPLOAD_FORM_FLAGS } from './direct-upload-pilot-config';

const tables=['roleplay_upload_reservations','roleplay_final_write_claims','roleplay_final_upload_evidence',
  'roleplay_direct_upload_budget','roleplay_direct_upload_budget_charges','roleplay_bilingual_openings',
  'roleplay_bilingual_opening_reservations','roleplay_bilingual_opening_reviews','roleplay_bilingual_opening_retired_paths'] as const;
const triggers=[
  ['roleplay_upload_reservations','roleplay_direct_upload_budget_charge'],
  ['roleplay_direct_upload_budget_charges','roleplay_upload_capability_state_guard'],
  ['roleplay_final_write_claims','roleplay_final_write_claim_guard'],
  ['roleplay_final_upload_evidence','roleplay_final_evidence_guard'],
  ['roleplay_bilingual_opening_reservations','roleplay_opening_retire_reservation'],
  ['roleplay_bilingual_opening_reservations','roleplay_opening_no_retired_reservation'],
  ['roleplay_bilingual_openings','roleplay_opening_no_retired_evidence'],
  ['roleplay_sessions','roleplay_opening_session_guard'],
  ['roleplay_responses','roleplay_opening_response_guard'],
  ['roleplay_scenarios','roleplay_opening_scenario_owner_guard'],
  ['roleplay_bilingual_openings','roleplay_opening_record_guard'],
] as const;
const flags = [...OPENING_ASSIGNMENT_FLAGS, ...DIRECT_UPLOAD_FORM_FLAGS];

// Only immutable, server-authored identifier lists enter these SQL strings.
const tableNames = tables.map(name => "'" + name + "'").join(',');
const triggerNames = triggers.map(([, name]) => "'" + name + "'").join(',');

/** Catalog snapshot only. No SQL installation, remote signing, or permission
 * to activate. Caller owns a bounded read-only transaction. */
export async function readRoleplayDirectRolloutReadiness(db:ReservationCatalogReader,env:Record<string,string|undefined>){
  const catalog=await db.query<{name:string;private_table:boolean}>(`
    SELECT c.relname AS name, (c.relrowsecurity AND c.relkind='r'
      AND NOT EXISTS(SELECT 1 FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname)
      AND NOT EXISTS(SELECT 1 FROM information_schema.role_table_grants g
        WHERE g.table_schema='public' AND g.table_name=c.relname AND g.grantee IN ('PUBLIC','anon','authenticated'))) AS private_table
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN (${tableNames})
  `);
  const triggerRows=await db.query<{table_name:string;name:string;enabled:boolean}>(`
    SELECT c.relname AS table_name,t.tgname AS name,(t.tgenabled IN ('O','A') AND NOT p.prosecdef) AS enabled
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE n.nspname='public' AND NOT t.tgisinternal AND t.tgname IN (${triggerNames})
  `);
  const columns=await db.query<{opening:boolean;capability:boolean;release_gate:boolean;assignment_hash:boolean}>(`
    SELECT
      EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='roleplay_sessions' AND column_name='requires_bilingual_opening' AND data_type='boolean' AND is_nullable='NO') AS opening,
      EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='roleplay_direct_upload_budget_charges' AND column_name='capability_state' AND data_type='text' AND is_nullable='NO') AS capability,
      EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='roleplay_direct_upload_budget' AND column_name='unused_release_enabled' AND data_type='boolean' AND is_nullable='NO') AS release_gate,
      EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='roleplay_direct_upload_budget_charges' AND column_name='assignment_hash' AND data_type='character varying' AND character_maximum_length=64) AS assignment_hash
  `);
  const tableChecks=tables.map(name=>({name,state:catalog.rows.some(r=>r.name===name&&r.private_table===true)?'present-private':catalog.rows.some(r=>r.name===name)?'review-required':'missing'}));
  const triggerChecks=triggers.map(([table,name])=>({table,name,enabled:triggerRows.rows.some(r=>r.table_name===table&&r.name===name&&r.enabled===true)}));
  const columnChecks={opening:columns.rows[0]?.opening===true,capability:columns.rows[0]?.capability===true,releaseGate:columns.rows[0]?.release_gate===true,assignmentHash:columns.rows[0]?.assignment_hash===true};
  const environment=flags.map(name=>({name,enabled:env[name]==='true'}));
  const schemaMetadataReady=tableChecks.every(t=>t.state==='present-private')&&triggerChecks.every(t=>t.enabled)&&Object.values(columnChecks).every(Boolean);
  let budget:{configured:boolean;remainingSlots:number|null;releaseEnabled:boolean|null}={configured:false,remainingSlots:null,releaseEnabled:null};
  if(columnChecks.releaseGate && tableChecks.find(t=>t.name==='roleplay_direct_upload_budget')?.state==='present-private'){
    const rows=await db.query<{max_slots:number;allocated_slots:number;unused_release_enabled:boolean}>('SELECT max_slots,allocated_slots,unused_release_enabled FROM public.roleplay_direct_upload_budget WHERE singleton=true');
    const b=rows.rows[0];
    if(rows.rows.length===1 && b && Number.isInteger(b.max_slots)&&Number.isInteger(b.allocated_slots)&&b.allocated_slots>=0&&b.max_slots>=b.allocated_slots&&b.max_slots<=25&&typeof b.unused_release_enabled==='boolean'){
      budget={configured:b.max_slots>0,remainingSlots:b.max_slots-b.allocated_slots,releaseEnabled:b.unused_release_enabled};
    }
  }
  const storageCatalog=await db.query<{present:boolean}>("SELECT to_regclass('storage.buckets') IS NOT NULL AS present");
  const bucketRows=storageCatalog.rows[0]?.present===true
    ? (await db.query<{id:string;name:string;public:boolean;file_size_limit:string;allowed_mime_types:string[]}>(`
      SELECT id,name,public,file_size_limit::text,allowed_mime_types FROM storage.buckets
      WHERE id IN ('roleplay-audio-private','roleplay-opening-private')
    `)).rows : [];
  const buckets=[
    {id:'roleplay-audio-private',types:['audio/mpeg','audio/wav','audio/webm','audio/mp4']},
    {id:'roleplay-opening-private',types:['audio/webm','audio/mp4','audio/ogg','audio/mpeg']},
  ].map(({id,types})=>{
    const row=bucketRows.find(r=>r.id===id);
    return {id,state:!row?'missing':row.name===id&&row.public===false&&row.file_size_limit==='15728640'&&
      Array.isArray(row.allowed_mime_types)&&row.allowed_mime_types.length===types.length&&
      types.every(type=>row.allowed_mime_types.includes(type))?'metadata-ready':'review-required'};
  });
  return {schemaMetadataReady,tableChecks,triggerChecks,columnChecks,environment,budget,buckets,
    deploymentAttestation:'not-verified',hostedStoragePilot:'not-verified',activationAuthorized:false as const};
}
