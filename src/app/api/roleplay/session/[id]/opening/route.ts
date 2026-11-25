import { NextRequest } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { resolveCurrentIdentity } from '@/lib/identity/resolve-user';
import { actorFromBearer } from '@/lib/api-auth';
import { privateRoleplayResponse } from '@/lib/roleplay/private-response';
import { applyRateLimit, rateLimit, createRateLimitHeaders } from '@/lib/security/rate-limit';
import { validateAudioMetadata } from '@/lib/roleplay';
import { authorizeOpeningUpload, confirmOpeningUpload, recoverOpeningDetails } from '@/lib/roleplay/bilingual-opening-service';
import { BilingualOpeningStoreError, type BilingualOpeningActor } from '@/lib/roleplay/bilingual-opening-store';

export const runtime = 'nodejs';

const sessionIdPattern = /^[a-zA-Z0-9_-]{1,100}$/;
const requestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('authorize'), mimeType: z.string().min(1).max(100),
    size: z.number().int().positive().max(15 * 1024 * 1024) }).strict(),
  z.object({ action: z.literal('confirm'), path: z.string().min(1).max(256) }).strict(),
]);

function failure(status: number, error: string, headers?: HeadersInit) {
  return privateRoleplayResponse({ success: false, error }, { status, headers });
}

// Bound actual streamed bytes, not just the browser's Content-Length.
async function readCommand(req: NextRequest) {
  if (req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json' || !req.body) return null;
  const reader = req.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let total = 0;
  let json = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 2048) return null;
      json += decoder.decode(value, { stream: true });
    }
    json += decoder.decode();
    const parsed = requestSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function handle(req: NextRequest, params: Promise<{ id: string }>, write: boolean) {
  // This flag is deliberately not set by this PR. Schema rollout, progression
  // guards, QA, cleanup and browser integration must precede any activation.
  if (process.env.ROLEPLAY_BILINGUAL_OPENING_API_ENABLED !== 'true') return failure(404, 'No disponible.');
  try {
    const ipLimit = applyRateLimit(req, { maxRequests: write ? 12 : 30, windowMs: 60_000,
      keyPrefix: write ? 'opening-write-ip' : 'opening-read-ip' });
    if (!ipLimit.success) return failure(429, 'Demasiadas solicitudes.', createRateLimitHeaders(ipLimit));
    if (write && req.headers.get('sec-fetch-site') === 'cross-site') return failure(403, 'Acceso denegado.');

    const { id } = await params;
    if (!sessionIdPattern.test(id)) return failure(400, 'Sesión inválida.');
    const identity = await resolveCurrentIdentity();
    if (!identity) return failure(401, 'Debes iniciar sesión.');
    if (req.headers.has('authorization')) {
      const bearer = await actorFromBearer(req);
      if (!bearer) return failure(401, 'Debes iniciar sesión.');
      if (bearer.userId !== identity.userId || bearer.role !== identity.role ||
          (identity.role === 'candidate' && bearer.candidateId !== identity.candidateId) ||
          (identity.role === 'interpreter' && bearer.interpreterId !== identity.interpreterId)) {
        return failure(403, 'Acceso denegado.');
      }
    }
    let actor: BilingualOpeningActor;
    if (identity.role === 'candidate' && identity.candidateId !== null) {
      actor = { role: 'candidate', candidateId: identity.candidateId,
        sessionCookie: req.cookies.get('roleplay_session')?.value ?? null };
      if (actor.sessionCookie !== id) return failure(403, 'Acceso denegado.');
    } else if (identity.role === 'interpreter' && identity.interpreterId !== null && !identity.eligibility?.needsOnboarding) {
      actor = { role: 'interpreter', interpreterId: identity.interpreterId };
    } else return failure(403, 'Acceso denegado.');

    // Per-actor limit in addition to the trusted ingress IP limiter. The
    // database reservation and verification lease remain the durable per-session gate.
    const quota = rateLimit(identity.userId, { maxRequests: write ? 6 : 30,
      windowMs: 60_000, keyPrefix: write ? 'opening-write-actor' : 'opening-read-actor' });
    if (!quota.success) return failure(429, 'Demasiadas solicitudes.', createRateLimitHeaders(quota));

    if (actor.role === 'candidate') {
      const application = await prisma.recruitmentApplication.findUnique({
        where: { candidateId: actor.candidateId }, select: { status: true },
      });
      if (!application || !['ROLEPLAY_PENDING', 'ROLEPLAY_IN_PROGRESS', 'ROLEPLAY_REVIEW'].includes(application.status)) {
        return failure(403, 'Acceso denegado.');
      }
    }

    if (!write) {
      const data = await recoverOpeningDetails(prisma, id, actor);
      return privateRoleplayResponse({ success: true, data });
    }
    const command = await readCommand(req);
    if (!command) return failure(400, 'Solicitud inválida.');
    if (command.action === 'authorize') {
      if (!validateAudioMetadata(command.mimeType, command.size).valid) return failure(400, 'Formato o tamaño de audio inválido.');
      const data = await authorizeOpeningUpload(prisma, id, actor, command);
      return privateRoleplayResponse({ success: true, data });
    }
    await confirmOpeningUpload(prisma, id, actor, command.path);
    return privateRoleplayResponse({ success: true, data: { state: 'confirmed' } });
  } catch (error) {
    if (error instanceof BilingualOpeningStoreError) {
      if (error.code === 'FORBIDDEN') return failure(403, 'Acceso denegado.');
      if (error.code === 'INVALID_EVIDENCE') return failure(400, 'Grabación inválida.');
      if (error.code === 'CONFLICT') return failure(409, 'La grabación tiene una reserva o verificación activa. Consulta su estado antes de reintentar.');
    }
    return failure(503, 'No se pudo procesar la apertura. Inténtalo nuevamente.');
  }
}

export function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(req, params, false);
}
export function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(req, params, true);
}
