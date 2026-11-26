import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Client } from 'pg';

/** Called only by the existing verifier after creating a random temporary
 * database on the isolated localhost CI service. Never a standalone CLI. */
export async function verifyFinalEvidencePostgres(first:Client,second:Client) {
  const location=await first.query<{name:string}>('SELECT current_database() AS name');
  if(process.env.CI!=='true' || process.env.NODE_ENV==='production' ||
    !/^rp_upload_ci_[0-9a-f]{12}$/.test(location.rows[0]?.name ?? ''))
    throw new Error('Disposable evidence database required');
  const sql=await readFile(resolve(process.cwd(),'docs/operations/staged-sql/roleplay-final-upload-evidence.sql'),'utf8');
  if(!sql.startsWith('-- STAGED ONLY.')) throw new Error('Unexpected evidence SQL');
  await first.query(sql);
  const meta=await first.query<{rls:boolean;policies:number;grants:number}>(`
    SELECT c.relrowsecurity AS rls,
      (SELECT count(*)::int FROM pg_policies WHERE schemaname='public' AND tablename='roleplay_final_upload_evidence') AS policies,
      (SELECT count(*)::int FROM information_schema.role_table_grants WHERE table_schema='public'
        AND table_name='roleplay_final_upload_evidence' AND grantee IN ('PUBLIC','anon','authenticated')) AS grants
    FROM pg_class c WHERE c.oid='public.roleplay_final_upload_evidence'::regclass
  `);
  if(meta.rows[0]?.rls!==true || meta.rows[0]?.policies!==0 || meta.rows[0]?.grants!==0)
    throw new Error('Final evidence isolation failed');

  async function reservation(status='VERIFIED',expired=false){
    const id=randomUUID(), key=randomUUID(), actor='ci-final-admin';
    const created=new Date(Date.now()-(expired?45*60_000:2000));
    const expires=new Date(created.getTime()+30*60_000);
    const items=[0,1].map(order=>({order,mime:'audio/mpeg',sizeBytes:3,sha256:'a'.repeat(64),path:'staging/roleplay/'+id+'/'+order+'.mp3'}));
    const evidence=items.map(({mime:_mime,...item})=>({...item,verifiedAtMs:created.getTime()+1}));
    await first.query(`
      INSERT INTO public.roleplay_upload_reservations
        (id,actor_user_id,request_key,declaration_hash,status,items,verified_objects,created_at,expires_at)
      VALUES($1::uuid,$2,$3::uuid,$4,$5,$6::jsonb,$7::jsonb,$8,$9)
    `,[id,actor,key,'b'.repeat(64),status,JSON.stringify(items),JSON.stringify(status==='VERIFIED'?evidence:[]),created,expires]);
    return {id,key,actor,created,expires};
  }
  const parent=await reservation();
  const reference=(id:string,order:number)=>'private-base/'+id+'/'+order+'.mp3';
  const insert=`INSERT INTO public.roleplay_final_upload_evidence
      (reservation_id,slot_order,reference,size_bytes,sha256,verified_at)
      VALUES($1::uuid,$2,$3,$4,$5,$6) RETURNING slot_order`;
  const values=(id:string,order:number)=>[id,order,reference(id,order),3,'a'.repeat(64),new Date()];
  async function reject(statement:string,params:unknown[],expected='23514'){
    let code:unknown;
    try{await first.query(statement,params);}catch(error){code=(error as {code?:string})?.code;}
    if(code!==expected) throw new Error('Invalid final evidence accepted or wrong SQLSTATE');
  }
  // Real DB rejects out-of-order, wrong source, wrong bytes, and expired rows.
  await reject(insert,values(parent.id,1));
  await reject(insert,[parent.id,0,reference(randomUUID(),0),3,'a'.repeat(64),new Date()]);
  await reject(insert,[parent.id,0,reference(parent.id,0),4,'a'.repeat(64),new Date()]);
  await reject(insert,[parent.id,0,reference(parent.id,0),3,'b'.repeat(64),new Date()]);
  await reject(insert,[parent.id,0,reference(parent.id,0).replace('.mp3','.wav'),3,'a'.repeat(64),new Date()]);
  await reject(insert,[parent.id,0,reference(parent.id,0),3,'a'.repeat(64),parent.created]);
  await reject(insert,[parent.id,0,reference(parent.id,0),3,'a'.repeat(64),new Date(Date.now()+60_000)]);
  const unverified=await reservation('RESERVED');
  await reject(insert,values(unverified.id,0));
  const expired=await reservation('VERIFIED',true);
  await reject(insert,values(expired.id,0));
  await reject(insert,values(randomUUID(),0));

  // Mirror the service's parent row lock and progress replay. One of two
  // concurrent clients inserts the slot; the other observes the same evidence.
  async function append(client:Client,order:number){
    await client.query('BEGIN');
    try{
      const locked=await client.query(`SELECT id FROM public.roleplay_upload_reservations
        WHERE id=$1::uuid AND actor_user_id=$2 AND request_key=$3::uuid AND status='VERIFIED'
          AND expires_at>clock_timestamp() FOR UPDATE`,[parent.id,parent.actor,parent.key]);
      if(locked.rowCount!==1) throw new Error('Parent lock failed');
      const existing=await client.query<{n:number}>('SELECT count(*)::int AS n FROM public.roleplay_final_upload_evidence WHERE reservation_id=$1::uuid',[parent.id]);
      const n=existing.rows[0]?.n;
      if(typeof n!=='number' || n<order) throw new Error('Evidence sequence invalid');
      if(n>order){await client.query('COMMIT');return false;}
      await client.query(insert,values(parent.id,order));
      await client.query('COMMIT');return true;
    }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}
  }
  const attempts=await Promise.all([append(first,0),append(second,0)]);
  if(attempts.filter(Boolean).length!==1) throw new Error('Concurrent final evidence was not deduplicated');
  await reject(insert,values(parent.id,0));
  await reject('UPDATE public.roleplay_final_upload_evidence SET size_bytes=4 WHERE reservation_id=$1::uuid',[parent.id]);

  // Exercise the same completeness condition required by the application.
  // This is a SQL-level simulation, not an invocation of the Prisma service.
  const complete=async()=>{
    const result=await first.query<{complete:boolean}>(`SELECT
      jsonb_array_length(r.items)=(SELECT count(*) FROM public.roleplay_final_upload_evidence e WHERE e.reservation_id=r.id) AS complete
      FROM public.roleplay_upload_reservations r WHERE r.id=$1::uuid`,[parent.id]);
    return result.rows[0]?.complete===true;
  };
  if(await complete()) throw new Error('Incomplete final evidence considered complete');
  await first.query('BEGIN');
  try{
    await first.query(insert,values(parent.id,1));
    await first.query('ROLLBACK');
  }catch(error){await first.query('ROLLBACK').catch(()=>undefined);throw error;}
  if(await complete()) throw new Error('Rolled-back evidence survived');
  if(!(await append(second,1)) || !(await complete())) throw new Error('Completed final batch was rejected');
  const final=await first.query<{slot_order:number;reference:string}>('SELECT slot_order,reference FROM public.roleplay_final_upload_evidence WHERE reservation_id=$1::uuid ORDER BY slot_order',[parent.id]);
  if(final.rows.length!==2 || final.rows.some((r,i)=>r.slot_order!==i || r.reference!==reference(parent.id,i))) throw new Error('Incorrect final references');
  await first.query("UPDATE public.roleplay_upload_reservations SET status='PUBLISHED',published_session_ids=ARRAY['ci-final-session'] WHERE id=$1::uuid",[parent.id]);
  await reject(insert,values(parent.id,0));
  // The FK is metadata-only: cascade removes evidence, not Storage audio.
  await first.query('DELETE FROM public.roleplay_upload_reservations WHERE id=$1::uuid',[parent.id]);
  const missing=await first.query('SELECT 1 FROM public.roleplay_final_upload_evidence WHERE reservation_id=$1::uuid',[parent.id]);
  if(missing.rowCount!==0) throw new Error('Evidence FK cascade failed');
  console.log('Final evidence PostgreSQL checks passed: isolation, source binding, expiry, ordered concurrency, immutable updates, rollback and FK cascade.');
}
