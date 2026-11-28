import type { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { resolveRoleplayCreationActor } from '@/lib/roleplay/creation-actor';
import { parseRoleplayReceiptRequest } from '@/lib/roleplay/creation-receipt';
import { privateRoleplayResponse } from '@/lib/roleplay/private-response';
import { lookupDirectReservationStatus } from '@/lib/roleplay/direct-reservation-status';
import { applyRateLimit, rateLimit, createRateLimitHeaders } from '@/lib/security/rate-limit';

const MAX_BYTES = 512;
const READ_TIMEOUT_MS = 5_000;

function fail(status: number, error: string, headers?: HeadersInit) {
  return privateRoleplayResponse({ success: false, error }, { status, headers });
}

async function readReference(req: Request): Promise<string> {
  if (!req.body) throw new Error('INVALID_REFERENCE');
  const reader = req.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function read() {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let bytes = 0, body = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw new Error('INVALID_REFERENCE');
      body += decoder.decode(value, { stream: true });
    }
    return parseRoleplayReceiptRequest(JSON.parse(body + decoder.decode()));
  }
  try {
    return await Promise.race([
      read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('INVALID_REFERENCE')), READ_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    try { void reader.cancel().catch(() => {}); } catch { /* best effort */ }
    reader.releaseLock();
  }
}

/** Administrative ledger observation. A reference is not a credential.
 * Disabled with the existing reservation pilot; no Storage calls or writes. */
export async function POST(req: NextRequest) {
  try {
    if (process.env.ROLEPLAY_DIRECT_UPLOAD_RESERVATION_API_ENABLED !== 'true') return fail(404, 'No disponible.');
    if (req.headers.get('sec-fetch-site') === 'cross-site') return fail(403, 'Acceso denegado.');
    const ip = applyRateLimit(req, { maxRequests: 30, windowMs: 60_000, keyPrefix: 'roleplay-direct-status-ip' });
    if (!ip.success) return fail(429, 'Demasiadas consultas.', createRateLimitHeaders(ip));
    const actor = await resolveRoleplayCreationActor(req);
    if (!actor) return fail(403, 'Acceso denegado.');
    const quota = rateLimit(actor, { maxRequests: 15, windowMs: 60_000, keyPrefix: 'roleplay-direct-status-admin' });
    if (!quota.success) return fail(429, 'Demasiadas consultas.', createRateLimitHeaders(quota));
    if (req.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
      return fail(415, 'Se requiere JSON.');
    }
    let key: string;
    try { key = await readReference(req); }
    catch { return fail(400, 'Referencia inválida o incompleta.'); }
    const result = await lookupDirectReservationStatus(prisma, actor, key);
    return privateRoleplayResponse({ success: true, data: result });
  } catch {
    return fail(503, 'No se pudo consultar la reserva. Conserva la referencia.');
  } finally {
    if (!req.bodyUsed) {
      try { void req.body?.cancel().catch(() => {}); } catch { /* best effort */ }
    }
  }
}
