import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
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
import { directInterpreterAssignment } from '@/lib/roleplay/direct-upload-interpreter-assignment';
import { recoverPublishedInterpreterRoleplay } from '@/lib/roleplay/direct-upload-interpreter-recovery';
import { createFinalClinicalStoragePort } from '@/lib/roleplay/direct-upload-final-storage';
import { publishVerifiedInterpreterRoleplay } from '@/lib/roleplay/direct-upload-publish-interpreter';
import { notifyRoleplayAssignments } from '@/lib/notifications/notify-roleplay';
import { revalidateCommittedRoleplayViews } from '@/lib/roleplay/admin-revalidation';

export const runtime = 'nodejs';
const MAX_COMMAND_BYTES = 32 * 1024;
let active = false;
const schema = z.object({
  requestKey: z.string().refine(isRoleplayDirectUploadRequestKey),
  assignment: directInterpreterAssignment,
}).strict();

function fail(status:number,error:string,headers?:HeadersInit) {
  return privateRoleplayResponse({success:false,error},{status,headers});
}
function canonicalOrigin() {
  const configured = process.env.FRONTEND_ORIGIN;
  if (!configured || /[\s\u0000-\u001f\u007f]/u.test(configured)) throw new Error('ORIGIN_UNAVAILABLE');
  const url = new URL(configured);
  const loopback = ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback && process.env.NODE_ENV !== 'production')) ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('ORIGIN_UNAVAILABLE');
  return url.origin;
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
      !openingAssignmentEnabled()) return fail(404,'No disponible.');
  let admitted=false;
  try {
    if(req.headers.get('sec-fetch-site')==='cross-site') return fail(403,'Acceso denegado.');
    const ip=applyRateLimit(req,{maxRequests:10,windowMs:60_000,keyPrefix:'roleplay-direct-publish-ip'});
    if(!ip.success) return fail(429,'Demasiadas solicitudes.',createRateLimitHeaders(ip));
    const auth=await validateAction('admin');
    if('error' in auth) return fail(403,'Acceso denegado.');
    if(req.headers.has('authorization')){
      const bearer=await actorFromBearer(req);
      if(!bearer || bearer.role!=='admin' || bearer.userId!==auth.user.userId) return fail(403,'Acceso denegado.');
    }
    const quota=rateLimit(auth.user.userId,{maxRequests:3,windowMs:60_000,keyPrefix:'roleplay-direct-publish-admin'});
    if(!quota.success) return fail(429,'Demasiadas solicitudes.',createRateLimitHeaders(quota));
    if(active) return fail(429,'Hay otra publicación en curso.');
    active=true; admitted=true;
    const command=await readCommand(req);
    if(!command) return fail(400,'Datos de publicación inválidos.');
    // A deliberately narrow pilot: never hold an HTTP request open for a
    // sequence of up to 25 consolidation transfers.
    if(command.assignment.scenarios.length!==1) return fail(409,'El piloto admite exactamente un escenario.');
    const origin=canonicalOrigin();
    const actor=auth.user.userId;
    const {requestKey,assignment}=command;
    let result=await recoverPublishedInterpreterRoleplay(prisma,actor,requestKey,assignment);
    if(!result){
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
      result=await publishVerifiedInterpreterRoleplay(prisma,createFinalClinicalStoragePort(storage,url,signal),actor,requestKey,assignment,signal);
    }
    // Replayed receipts may refer to a progressed/cancelled session. Notify
    // only when still invited; deterministic event key prevents duplicates.
    try {
      const current=await prisma.roleplaySession.findUnique({where:{id:result.sessionId},select:{status:true,interpreterId:true,recruitmentCandidateId:true}});
      if(current?.status==='INVITED' && current.interpreterId===assignment.interpreterId && current.recruitmentCandidateId===null)
        await notifyRoleplayAssignments([{id:result.sessionId,interpreterId:assignment.interpreterId}]);
    } catch { /* committed publication must remain successful */ }
    revalidateCommittedRoleplayViews(revalidatePath);
    return privateRoleplayResponse({success:true,data:{...result,inviteLink:origin+'/roleplays/'+encodeURIComponent(result.sessionId)}});
  } catch {
    return fail(503,'No se pudo confirmar la publicación. Conserva la reserva y consulta el mismo intento.');
  } finally { if(admitted) active=false; }
}
