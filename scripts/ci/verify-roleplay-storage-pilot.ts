import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

// No production fallback, no .env loading, no network destination except
// the fixed local stack on a disposable GitHub-hosted runner.
const origin='http://127.0.0.1:54321';
const bucket='roleplay-audio-private';
function assert(condition:unknown,step:string):asserts condition {
  if(!condition) throw new Error(step);
}
function wav(sample:number){
  const data=Buffer.alloc(44+1600);
  data.write('RIFF',0);data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);
  data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);
  data.writeUInt32LE(8000,24);data.writeUInt32LE(16000,28);data.writeUInt16LE(2,32);data.writeUInt16LE(16,34);
  data.write('data',36);data.writeUInt32LE(1600,40);
  for(let i=44;i<data.length;i+=2)data.writeInt16LE(sample,i);
  return new Uint8Array(data);
}
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
async function main(){
  assert(process.env.CI==='true' && process.env.GITHUB_ACTIONS==='true' &&
    process.env.ROLEPLAY_ISOLATED_STORAGE_PILOT==='true' && process.env.NODE_ENV!=='production','isolated CI required');
  const path=process.env.ROLEPLAY_LOCAL_STATUS_FILE;
  assert(path,'local status missing');
  const status=JSON.parse(await readFile(path,'utf8')) as Record<string,unknown>;
  assert(status.API_URL===origin || status.API_URL==='http://localhost:54321','local origin mismatch');
  assert(typeof status.ANON_KEY==='string' && typeof status.SERVICE_ROLE_KEY==='string' &&
    status.ANON_KEY!==status.SERVICE_ROLE_KEY,'local keys missing');
  const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    global:{fetch:(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=new URL(input instanceof Request?input.url:String(input));
      assert(url.origin===origin,'nonlocal network refused');
      const signal=AbortSignal.timeout(20_000);
      return fetch(input,{...init,redirect:'error',signal:init?.signal?AbortSignal.any([init.signal,signal]):signal});
    }}};
  const admin=createClient(origin,status.SERVICE_ROLE_KEY,options).storage;
  const anon=createClient(origin,status.ANON_KEY,options).storage;
  const before=await admin.listBuckets();
  assert(!before.error && before.data?.length===0,'stack must have no existing buckets');
  const created=await admin.createBucket(bucket,{public:false,fileSizeLimit:15*1024*1024,
    allowedMimeTypes:['audio/mpeg','audio/wav','audio/webm','audio/mp4']});
  assert(!created.error,'private bucket creation failed');
  const metadata=await admin.getBucket(bucket);
  assert(!metadata.error && metadata.data?.public===false &&
    metadata.data.file_size_limit===15*1024*1024 &&
    [...(metadata.data.allowed_mime_types??[])].sort().join(',')==='audio/mp4,audio/mpeg,audio/wav,audio/webm','bucket metadata mismatch');
  const id=randomUUID(), source='staging/roleplay/'+id+'/0.wav', final='base/'+id+'/0.wav';
  const a=wav(100),b=wav(200),opts={upsert:false,contentType:'audio/wav',cacheControl:'0'};
  const privileged=admin.from(bucket), browser=anon.from(bucket);
  const read=async(p:string)=>{
    const result=await privileged.download(p);
    assert(!result.error && result.data,'privileged download failed');
    return digest(new Uint8Array(await result.data.arrayBuffer()));
  };
  const signature=await privileged.createSignedUploadUrl(source,{upsert:false});
  assert(!signature.error && signature.data?.path===source && signature.data.token,'signing failed');
  const token=signature.data.token;
  const wrong=await browser.uploadToSignedUrl(final,token,a,opts);
  assert(wrong.error,'staging token authorized final path');
  const first=await browser.uploadToSignedUrl(source,token,a,opts);
  assert(!first.error && await read(source)===digest(a),'signed staging upload failed');
  const replay=await browser.uploadToSignedUrl(source,token,b,{...opts,upsert:true});
  assert(replay.error && await read(source)===digest(a),'signed replay overwrote source');
  // Separate sequential control from the actual race. Only log fixed
  // categories, never provider messages, paths, tokens or object bytes.
  const control='base/'+id+'/2.wav';
  const classify=(error:unknown)=>{
    if(!error) return 'accepted';
    if(typeof error!=='object') return 'rejected-unknown';
    const e=error as {status?:unknown;statusCode?:unknown;code?:unknown};
    const status=String(e.statusCode??e.status??'');
    return /^(400|401|403|404|409|413|415|422|429|500|502|503|504)$/.test(status)?'rejected-'+status:'rejected-other';
  };
  const baseline=await privileged.upload(control,a,opts);
  console.log('Sequential destination control: '+classify(baseline.error));
  assert(!baseline.error && await read(control)===digest(a),'sequential destination control failed');
  const controlReplay=await privileged.upload(control,b,opts);
  console.log('Sequential duplicate control: '+classify(controlReplay.error));
  assert(controlReplay.error && await read(control)===digest(a),'sequential duplicate changed destination');
  const attempts=await Promise.all([privileged.upload(final,a,opts),privileged.upload(final,b,opts)]);
  console.log('Concurrent destination outcomes: '+attempts.map(r=>classify(r.error)).join(', '));
  const observed=await privileged.download(final);
  if(observed.error || !observed.data) console.log('Concurrent object observation: '+classify(observed.error));
  else {
    const sha=digest(new Uint8Array(await observed.data.arrayBuffer()));
    console.log('Concurrent object observation: '+(sha===digest(a)?'first fixture':sha===digest(b)?'second fixture':'unexpected bytes'));
  }
  assert(attempts.filter(r=>!r.error).length===1,'concurrent destination writes did not have one winner');
  const winner=attempts[0].error?b:a, loser=attempts[0].error?a:b;
  assert(await read(final)===digest(winner),'winner digest mismatch');
  const duplicate=await privileged.upload(final,loser,opts);
  assert(duplicate.error && await read(final)===digest(winner),'destination was overwritten');
  assert((await browser.download(final)).error,'anonymous download permitted');
  assert((await browser.createSignedUrl(final,60)).error,'anonymous signing permitted');
  assert((await browser.createSignedUploadUrl('base/'+id+'/1.wav',{upsert:false})).error,'anonymous upload signing permitted');
  assert((await browser.upload('base/'+id+'/1.wav',a,opts)).error,'anonymous unsigned upload permitted');
  const publicUrl=privileged.getPublicUrl(final).data.publicUrl;
  assert(new URL(publicUrl).origin===origin,'unexpected public origin');
  const publicResponse=await options.global.fetch(publicUrl);
  assert(!publicResponse.ok,'private object public URL returned bytes');
  await publicResponse.body?.cancel().catch(()=>{});
  const signed=await privileged.createSignedUrl(final,60);
  assert(!signed.error && signed.data?.signedUrl,'privileged signing failed');
  const response=await options.global.fetch(signed.data.signedUrl);
  assert(response.ok && digest(new Uint8Array(await response.arrayBuffer()))===digest(winner),'signed playback digest mismatch');
  console.log('Local Storage pilot passed: private metadata, scoped signed upload, replay rejection, concurrent non-overwrite, anonymous denial and signed playback digest.');
}
void main().catch(error=>{
  // Only fixed assertion labels, never SDK/provider payloads or credentials.
  const message=error instanceof Error?error.message:'unknown';
  const safe=/^[a-zA-Z ]{1,100}$/.test(message)?message:'provider or runtime error';
  console.error('Local Storage pilot failed: '+safe);
  process.exitCode=1;
});
