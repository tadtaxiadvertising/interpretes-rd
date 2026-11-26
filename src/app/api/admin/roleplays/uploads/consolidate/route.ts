import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import prisma from '@/lib/prisma';
import { validateAction } from '@/lib/auth/actions';
import { actorFromBearer } from '@/lib/api-auth';
import { applyRateLimit, rateLimit, createRateLimitHeaders } from '@/lib/security/rate-limit';
import { privateRoleplayResponse } from '@/lib/roleplay/private-response';
import { openingAssignmentEnabled } from '@/lib/roleplay/bilingual-opening-assignment';
import { requireBilingualOpeningBucket } from '@/lib/roleplay/bilingual-opening-bucket';
import { isRoleplayDirectUploadRequestKey } from '@/lib/roleplay/direct-upload-reservation-fingerprint';
import { ROLEPLAY_MAX_SCENARIOS } from '@/lib/roleplay-limits';
import { createFinalClinicalStoragePort } from '@/lib/roleplay/direct-upload-final-storage';
import { consolidateDirectUploadSlot } from '@/lib/roleplay/direct-upload-final-evidence';

export const runtime = 'nodejs';
const MAX_COMMAND_BYTES = 1024;
let active = false;
const schema = z.object({
  requestKey: z.string().refine(isRoleplayDirectUploadRequestKey),
  order: z.number().int().min(0).max(ROLEPLAY_MAX_SCENARIOS-1),
}).strict();

function fail(status:number,error:string,headers?:HeadersInit) {
  return privateRoleplayResponse({success:false,error},{status,headers});
}
async function readCommand(req:NextRequest) {
  if (req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json' || !req.body) return null;
  const reader = req.body.getReader(), decoder = new TextDecoder('utf-8',{fatal:true});
  let bytes=0, body='';
  try {
    for (;;) {
      const {done,value}=await reader.read();
      if(done) break;
      bytes+=value.byteLength;
      if(bytes>MAX_COMMAND_BYTES) return null;
      body+=decoder.decode(value,{stream:true});
    }
    const parsed=schema.safeParse(JSON.parse(body+decoder.decode()));
    return parsed.success?parsed.data:null;
  } catch { return null; }
  finally { await reader.cancel().catch(()=>{}); reader.releaseLock(); }
}

export async function POST(req:NextRequest) {
  if (process.env.ROLEPLAY_DIRECT_UPLOAD_RESERVATION_API_ENABLED !== 'true' ||
      process.env.ROLEPLAY_DIRECT_UPLOAD_VERIFICATION_API_ENABLED !== 'true' ||
      process.env.ROLEPLAY_DIRECT_UPLOAD_PUBLICATION_ENABLED !== 'true' ||
      process.env.ROLEPLAY_DIRECT_UPLOAD_PUBLICATION_PILOT_API_ENABLED !== 'true' ||
      process.env.ROLEPLAY_DIRECT_UPLOAD_INCREMENTAL_API_ENABLED !== 'true' ||
      !openingAssignmentEnabled()) return fail(404,'No disponible.');
  let admitted=false;
  try {
    if(req.headers.get('sec-fetch-site')==='cross-site') return fail(403,'Acceso denegado.');
    const ip=applyRateLimit(req,{maxRequests:60,windowMs:60_000,keyPrefix:'roleplay-direct-consolidate-ip'});
    if(!ip.success) return fail(429,'Demasiadas solicitudes.',createRateLimitHeaders(ip));
    const auth=await validateAction('admin');
    if('error' in auth) return fail(403,'Acceso denegado.');
    if(req.headers.has('authorization')){
      const bearer=await actorFromBearer(req);
      if(!bearer || bearer.role!=='admin' || bearer.userId!==auth.user.userId) return fail(403,'Acceso denegado.');
    }
    const quota=rateLimit(auth.user.userId,{maxRequests:35,windowMs:60_000,keyPrefix:'roleplay-direct-consolidate-admin'});
    if(!quota.success) return fail(429,'Demasiadas solicitudes.',createRateLimitHeaders(quota));
    if(active) return fail(429,'Hay otro audio en consolidación.');
    active=true; admitted=true;
    const command=await readCommand(req);
    if(!command) return fail(400,'Datos de publicación inválidos.');
    const url=process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
    if(!url || !key) return fail(503,'Almacenamiento no disponible.');
    const signal=AbortSignal.any([req.signal,AbortSignal.timeout(90_000)]);
    const storage=createClient(url,key,{
      auth:{persistSession:false,autoRefreshToken:false},
      global:{fetch:(input,init)=>fetch(input,{...init,redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(30_000),...(init?.signal?[init.signal]:[])])})},
    }).storage;
    await requireBilingualOpeningBucket(storage);
    if(signal.aborted) return fail(503,'Publicación interrumpida. Conserva la reserva.');
    const result=await consolidateDirectUploadSlot(prisma,createFinalClinicalStoragePort(storage,url,signal),auth.user.userId,command.requestKey,command.order,signal);
    return privateRoleplayResponse({success:true,data:result});
  } catch {
    return fail(503,'No se pudo consolidar el audio. Conserva la reserva y reintenta la misma posición.');
  } finally { if(admitted) active=false; }
}
