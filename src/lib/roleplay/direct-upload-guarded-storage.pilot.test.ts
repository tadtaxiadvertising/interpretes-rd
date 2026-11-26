// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createClient } from '@supabase/supabase-js';
import { describe, it, expect } from 'vitest';
import { prepareRoleplayDirectUploadBatch } from './direct-upload-contract';
import { fingerprintRoleplayDirectUploadDeclarations } from './direct-upload-reservation-fingerprint';
import { promoteVerifiedClinicalSlot, type FinalObjectPort } from './direct-upload-promote-slot';
import { verifyDecodedClinicalAudio } from './direct-upload-audio-decoder';

const origin='http://127.0.0.1:54321';
const bucket='roleplay-audio-private';
const enabled=process.env.ROLEPLAY_ISOLATED_STORAGE_PILOT==='true' &&
  process.env.CI==='true' && process.env.GITHUB_ACTIONS==='true' &&
  !!process.env.ROLEPLAY_LOCAL_STATUS_FILE && process.env.NODE_ENV!=='production';
function assert(value:unknown, message:string):asserts value{
  if(!value) throw new Error(message);
}
function wav(){
  const b=Buffer.alloc(1644);
  b.write('RIFF',0);b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);
  b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);
  b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);
  b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(1600,40);
  return new Uint8Array(b);
}
const digest=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
describe.skipIf(!enabled)('isolated guarded Storage pilot',()=>{
  it('admits one real write across separate Prisma clients and recovers by decoding existing bytes',async()=>{
    const status=JSON.parse(await readFile(process.env.ROLEPLAY_LOCAL_STATUS_FILE!,'utf8')) as Record<string,unknown>;
    assert(status.API_URL===origin || status.API_URL==='http://localhost:54321','local API required');
    assert(typeof status.DB_URL==='string' && typeof status.SERVICE_ROLE_KEY==='string','local status incomplete');
    const dbUrl=new URL(status.DB_URL);
    assert(['postgres:','postgresql:'].includes(dbUrl.protocol) &&
      ['127.0.0.1','localhost'].includes(dbUrl.hostname) && dbUrl.port==='54322' &&
      dbUrl.pathname==='/postgres' && dbUrl.username==='postgres' &&
      !dbUrl.search && !dbUrl.hash,'local database required');
    dbUrl.hostname='127.0.0.1';
    const config={connectionString:dbUrl.toString(),connectionTimeoutMillis:5000,statement_timeout:10000,ssl:false as const};
    const setup=new Client(config);
    const db1=new PrismaClient({adapter:new PrismaPg({...config,max:1})});
    const db2=new PrismaClient({adapter:new PrismaPg({...config,max:1})});
    try{
      await setup.connect();
      const fresh=await setup.query<{fresh:boolean}>("SELECT to_regclass('public.roleplay_upload_reservations') IS NULL AND to_regclass('public.roleplay_final_write_claims') IS NULL AS fresh");
      assert(fresh.rows[0]?.fresh,'local database not fresh');
      for(const name of ['roleplay-upload-reservations.sql','roleplay-final-write-claims.sql']){
        await setup.query(await readFile(resolve(process.cwd(),'docs/operations/staged-sql',name),'utf8'));
      }
      const storage=createClient(origin,status.SERVICE_ROLE_KEY,{
        auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
        global:{fetch:(input,init)=>{
          const url=new URL(input instanceof Request?input.url:String(input));
          assert(url.origin===origin,'nonlocal storage refused');
          return fetch(input,{...init,redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(20_000),...(init?.signal?[init.signal]:[])])});
        }},
      }).storage;
      // The raw diagnostic has its own assertions and may have created this
      // bucket already. Use only synthetic UUID paths on this disposable stack.
      const buckets=await storage.listBuckets();
      assert(!buckets.error && buckets.data?.every(b=>b.id===bucket),'unexpected local buckets');
      if(!buckets.data?.some(b=>b.id===bucket)){
        const created=await storage.createBucket(bucket,{public:false,fileSizeLimit:15*1024*1024,allowedMimeTypes:['audio/mpeg','audio/wav','audio/webm','audio/mp4']});
        assert(!created.error,'local bucket create failed');
      }
      const metadata=await storage.getBucket(bucket);
      assert(!metadata.error && metadata.data?.public===false && metadata.data.file_size_limit===15*1024*1024,'local bucket not private');
      const api=storage.from(bucket),bytes=wav(),sha256=digest(bytes);
      async function fixture(){
        const id=randomUUID(),key=randomUUID(),actor='ci-guarded-admin';
        const items=prepareRoleplayDirectUploadBatch(id,[{order:0,mime:'audio/wav',sizeBytes:bytes.length,sha256}]).items;
        const created=new Date(Date.now()-1000),expires=new Date(created.getTime()+30*60_000);
        const source=await api.upload(items[0].path,bytes,{upsert:false,contentType:'audio/wav',cacheControl:'0'});
        assert(!source.error,'synthetic source upload failed');
        await setup.query(`
          INSERT INTO public.roleplay_upload_reservations(id,actor_user_id,request_key,declaration_hash,status,items,verified_objects,created_at,expires_at)
          VALUES($1::uuid,$2,$3::uuid,$4,'VERIFIED',$5::jsonb,$6::jsonb,$7,$8)
        `,[id,actor,key,fingerprintRoleplayDirectUploadDeclarations(items),JSON.stringify(items),
          JSON.stringify(items.map(({order,path,sizeBytes,sha256})=>({order,path,sizeBytes,sha256,verifiedAtMs:created.getTime()}))),created,expires]);
        return {id,key,actor,item:items[0]};
      }
      const read=async(path:string)=>{
        const result=await api.download(path);
        assert(!result.error && result.data,'local object unavailable');
        return new Uint8Array(await result.data.arrayBuffer());
      };
      let writes=0;
      const port:FinalObjectPort={
        async copyIfAbsent(item,destination){
          const source=await read(item.path);
          assert(source.length===item.sizeBytes && digest(source)===item.sha256,'source digest mismatch');
          writes++;
          const result=await api.upload(destination,source,{upsert:false,contentType:item.mime,cacheControl:'0'});
          assert(!result.error,'guarded upload failed');
          // Deliberately lose the acknowledgement after actual Storage success.
          throw new Error('synthetic lost acknowledgement');
        },
        async verify(item){
          const actual=await read(item.path);
          return verifyDecodedClinicalAudio(new Response(actual).body!,item);
        },
      };
      const f=await fixture();
      const results=await Promise.allSettled([
        promoteVerifiedClinicalSlot(db1,port,f.actor,f.key,0),
        promoteVerifiedClinicalSlot(db2,port,f.actor,f.key,0),
      ]);
      // A concurrent reader may see a missing or currently decoding object;
      // it must never send a second write. At least one must verify.
      expect(results.some(r=>r.status==='fulfilled')).toBe(true);
      expect(writes).toBe(1);
      const replay=await promoteVerifiedClinicalSlot(db2,port,f.actor,f.key,0);
      expect(replay).toEqual({order:0,reference:'private-base/'+f.id+'/0.wav',sizeBytes:bytes.length,sha256});
      expect(writes).toBe(1);
      expect(digest(await read('base/'+f.id+'/0.wav'))).toBe(sha256);
      const count=await setup.query<{n:number}>('SELECT count(*)::int AS n FROM public.roleplay_final_write_claims WHERE reservation_id=$1::uuid',[f.id]);
      expect(count.rows[0]?.n).toBe(1);

      // A crash before bytes are written cannot recycle the authorization.
      const g=await fixture();
      let attempts=0;
      const interrupted:FinalObjectPort={...port,copyIfAbsent:async()=>{attempts++;throw new Error('synthetic interruption before upload');}};
      for(const db of [db1,db2]) await expect(promoteVerifiedClinicalSlot(db,interrupted,g.actor,g.key,0)).rejects.toThrow();
      expect(attempts).toBe(1);
      const missing=await api.download('base/'+g.id+'/0.wav');
      expect(Boolean(missing.error)).toBe(true);
      console.log('Guarded Storage pilot passed: one write, lost acknowledgement recovered, actual decode, permanent failed-attempt fence.');
    }finally{
      await Promise.allSettled([db1.$disconnect(),db2.$disconnect(),setup.end()]);
    }
  },120_000);
});
