import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import prisma from '@/lib/prisma';
import { validateAction } from '@/lib/auth/actions';
import { actorFromBearer } from '@/lib/api-auth';
import { privateRoleplayResponse } from '@/lib/roleplay/private-response';
import { applyRateLimit, rateLimit, createRateLimitHeaders } from '@/lib/security/rate-limit';
import { ROLEPLAY_MAX_SCENARIOS } from '@/lib/roleplay-limits';
import { isRoleplayDirectUploadRequestKey } from '@/lib/roleplay/direct-upload-reservation-fingerprint';
import { verifyDirectUploadSlot } from '@/lib/roleplay/direct-upload-verify-slot';
import { verifyReservedStorageObject } from '@/lib/roleplay/direct-upload-storage-verifier';

export const runtime = 'nodejs';
const MAX_COMMAND_BYTES = 1024;
let activeVerification = false;
const schema = z.object({
  requestKey: z.string().refine(isRoleplayDirectUploadRequestKey),
  order: z.number().int().min(0).max(ROLEPLAY_MAX_SCENARIOS - 1),
}).strict();

function fail(status: number, error: string, headers?: HeadersInit) {
  return privateRoleplayResponse({ success: false, error }, { status, headers });
}
async function readCommand(req: NextRequest) {
  if (req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json' || !req.body) return null;
  const reader = req.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0, body = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_COMMAND_BYTES) return null;
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    const command = schema.safeParse(JSON.parse(body));
    if (!command.success) return null;
    return command.data;
  } catch { return null; }
  finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function POST(req: NextRequest) {
  if (process.env.ROLEPLAY_DIRECT_UPLOAD_RESERVATION_API_ENABLED !== 'true' ||
      process.env.ROLEPLAY_DIRECT_UPLOAD_VERIFICATION_API_ENABLED !== 'true') return fail(404, 'No disponible.');
  let admitted = false;
  try {
    if (req.headers.get('sec-fetch-site') === 'cross-site') return fail(403, 'Acceso denegado.');
    const ip = applyRateLimit(req, { maxRequests: 60, windowMs: 60_000, keyPrefix: 'roleplay-direct-verify-ip' });
    if (!ip.success) return fail(429, 'Demasiadas solicitudes.', createRateLimitHeaders(ip));
    const auth = await validateAction('admin');
    if ('error' in auth) return fail(403, 'Acceso denegado.');
    if (req.headers.has('authorization')) {
      const bearer = await actorFromBearer(req);
      if (!bearer || bearer.role !== 'admin' || bearer.userId !== auth.user.userId) return fail(403, 'Acceso denegado.');
    }
    const quota = rateLimit(auth.user.userId, { maxRequests: 35, windowMs: 60_000, keyPrefix: 'roleplay-direct-verify-admin' });
    if (!quota.success) return fail(429, 'Demasiadas solicitudes.', createRateLimitHeaders(quota));
    if (activeVerification) return fail(429, 'Hay otro archivo en verificación. Reintenta este archivo.');
    activeVerification = true;
    admitted = true;
    const command = await readCommand(req);
    if (!command) return fail(400, 'Declaración de archivos inválida.');
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return fail(503, 'Almacenamiento no disponible.');
    const storage = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }) },
    }).storage;
    const result = await verifyDirectUploadSlot(prisma, auth.user.userId, command.requestKey, command.order,
      item => verifyReservedStorageObject(storage, url, item, req.signal));
    if (result.kind === 'NOT_FOUND') return fail(404, 'Reserva no disponible.');
    if (result.kind !== 'PROGRESS') return fail(409, 'La reserva no permite verificar este archivo. Consulta su estado.');
    return privateRoleplayResponse({ success: true, data: result });
  } catch {
    return fail(503, 'No se pudo verificar el archivo. Conserva la reserva y reintenta la verificación.');
  } finally {
    if (admitted) activeVerification = false;
  }
}
