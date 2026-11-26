'use client';

import { createClient } from '@supabase/supabase-js';
import { createRoleplayUploadController } from './direct-upload-browser-resume';
import { ROLEPLAY_PRIVATE_AUDIO_BUCKET } from './private-audio-bucket-readiness';

async function command(path:'reserve'|'verify', body:unknown, signal?:AbortSignal) {
  const timeout = AbortSignal.timeout(60_000);
  const response = await fetch('/api/admin/roleplays/uploads/'+path, {
    method:'POST', credentials:'same-origin', cache:'no-store', redirect:'error',
    headers:{'Content-Type':'application/json'}, body:JSON.stringify(body),
    signal:signal?AbortSignal.any([signal,timeout]):timeout,
  });
  if (!response.ok) throw new Error('ROLEPLAY_UPLOAD_REQUEST_FAILED');
  const result:unknown = await response.json();
  if (!result || typeof result!=='object' || !('success' in result) || result.success!==true ||
      !('data' in result)) throw new Error('ROLEPLAY_UPLOAD_REQUEST_FAILED');
  return result.data;
}

/** Staged browser connection. Only public project configuration is used.
 * No persistent SDK session, service role, or token storage. */
export function createConfiguredRoleplayUploadController(files:readonly File[]) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('ROLEPLAY_UPLOAD_CONFIG_UNAVAILABLE');
  return createRoleplayUploadController(files,{
    reserve:(requestKey,declarations,signal)=>command('reserve',{requestKey,declarations},signal),
    inspect:(requestKey,order,signal)=>command('verify',{requestKey,order,mode:'inspect'},signal),
    verify:(requestKey,order,signal)=>command('verify',{requestKey,order,mode:'verify'},signal),
    transfer:async(slot,file,signal)=>{
      const storage = createClient(url,key,{
        auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
        global:{fetch:(input,init)=>{
          const signals=[AbortSignal.timeout(120_000)];
          if(signal) signals.push(signal);
          if(init?.signal) signals.push(init.signal);
          return fetch(input,{...init,redirect:'error',signal:AbortSignal.any(signals)});
        }},
      }).storage;
      const {error}=await storage.from(ROLEPLAY_PRIVATE_AUDIO_BUCKET)
        .uploadToSignedUrl(slot.path,slot.token,file,{upsert:false,contentType:slot.mime});
      return {error};
    },
  });
}
