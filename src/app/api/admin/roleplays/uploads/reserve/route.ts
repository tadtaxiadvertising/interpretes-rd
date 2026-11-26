import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import prisma from '@/lib/prisma';
import { validateAction } from '@/lib/auth/actions';
import { actorFromBearer } from '@/lib/api-auth';
import { privateRoleplayResponse } from '@/lib/roleplay/private-response';
import { applyRateLimit, rateLimit, createRateLimitHeaders } from '@/lib/security/rate-limit';
import { ROLEPLAY_MAX_SCENARIOS } from '@/lib/roleplay-limits';
import { prepareRoleplayDirectUploadBatch, ROLEPLAY_DIRECT_UPLOAD_MAX_FILE_BYTES } from '@/lib/roleplay/direct-upload-contract';
import { isRoleplayDirectUploadRequestKey } from '@/lib/roleplay/direct-upload-reservation-fingerprint';
import { reserveAndSignDirectUpload } from '@/lib/roleplay/direct-upload-signing';

import { directInterpreterAssignment } from '@/lib/roleplay/direct-upload-interpreter-assignment';

export const runtime = 'nodejs';
const MAX_COMMAND_BYTES = 1024 * 1024;
const schema = z.object({
  requestKey: z.string().refine(isRoleplayDirectUploadRequestKey),
  assignment: directInterpreterAssignment,
  declarations: z.array(z.object({
    order: z.number().int().min(0).max(ROLEPLAY_MAX_SCENARIOS - 1),
    mime: z.enum(['audio/mpeg','audio/wav','audio/webm','audio/mp4']),
    sizeBytes: z.number().int().positive().max(ROLEPLAY_DIRECT_UPLOAD_MAX_FILE_BYTES),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict()).min(1).max(ROLEPLAY_MAX_SCENARIOS),
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
    if (!command.success || command.data.assignment.scenarios.length!==command.data.declarations.length) return null;
    // Full validation (including order) before touching Storage or database.
    prepareRoleplayDirectUploadBatch('123e4567-e89b-42d3-a456-426614174000', command.data.declarations);
    return command.data;
  } catch { return null; }
  finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function POST(req: NextRequest) {
  // Explicitly staged. Do not enable until reconciliation, byte verification,
  // atomic publication, quotas, and the real storage pilot are complete.
  if (process.env.ROLEPLAY_DIRECT_UPLOAD_RESERVATION_API_ENABLED !== 'true') return fail(404, 'No disponible.');
  try {
    if (req.headers.get('sec-fetch-site') === 'cross-site') return fail(403, 'Acceso denegado.');
    const ip = applyRateLimit(req, { maxRequests: 10, windowMs: 60_000, keyPrefix: 'roleplay-direct-reserve-ip' });
    if (!ip.success) return fail(429, 'Demasiadas solicitudes.', createRateLimitHeaders(ip));
    const auth = await validateAction('admin');
    if ('error' in auth) return fail(403, 'Acceso denegado.');
    if (req.headers.has('authorization')) {
      const bearer = await actorFromBearer(req);
      if (!bearer || bearer.role !== 'admin' || bearer.userId !== auth.user.userId) return fail(403, 'Acceso denegado.');
    }
    const quota = rateLimit(auth.user.userId, { maxRequests: 3, windowMs: 60_000, keyPrefix: 'roleplay-direct-reserve-admin' });
    if (!quota.success) return fail(429, 'Demasiadas solicitudes.', createRateLimitHeaders(quota));
    const command = await readCommand(req);
    if (!command) return fail(400, 'Declaración de archivos inválida.');
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return fail(503, 'Almacenamiento no disponible.');
    const storage = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }) },
    }).storage;
    const result = await reserveAndSignDirectUpload(prisma, storage, auth.user.userId, command.requestKey, command.declarations, command.assignment);
    if (result.kind === 'CONFLICT') return fail(409, 'La solicitud ya corresponde a otro lote.');
    if (result.kind === 'RECONCILE') return fail(409, 'Existe una reserva previa. Consulta su estado antes de reintentar.');
    return privateRoleplayResponse({ success: true, data: result });
  } catch {
    return fail(503, 'No se pudo preparar la subida. No inicies otro lote sin comprobar el anterior.');
  }
}
