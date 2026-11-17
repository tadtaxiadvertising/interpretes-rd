import { NextRequest } from 'next/server';
import { getHappyScribeSettings } from '@/lib/roleplay/happyscribe-settings';
import { issueHappyScribeImportProof, verifyHappyScribeImportProof } from '@/lib/roleplay/happyscribe-import-proof';
import { setTimeout as delay } from 'node:timers/promises';
import { discardHappyScribeDownload, fetchHappyScribeExport, isAllowedHappyScribeExportUrl } from '@/lib/roleplay/happyscribe-download';
import { isValidHappyScribeId } from '@/lib/roleplay/happyscribe-id';
import { validateAction } from '@/lib/auth/actions';
import { matchesExplicitAdminBearer } from '@/lib/roleplay/happyscribe-admin-identity';
import { privateRoleplayResponse } from '@/lib/roleplay/private-response';
import { applyRateLimit, createRateLimitHeaders, RATE_LIMITS } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 30;

const API_BASE = 'https://www.happyscribe.com/api/v1';

async function configuration() {
  const { token, organizationId, mediaImportEnabled } = await getHappyScribeSettings();
  if (!token || !/^\d+$/.test(organizationId)) return null;
  return { token, organizationId, mediaImportEnabled };
}

async function happyScribeFetch(path: string, token: string, init?: RequestInit, requestSignal?: AbortSignal) {
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
    signal: requestSignal
      ? AbortSignal.any([requestSignal, AbortSignal.timeout(20_000)])
      : AbortSignal.timeout(20_000),
  });
}

/** Admin-only, read-only listing. API credentials never reach the browser. */
export async function GET(req: NextRequest) {
  const auth = await validateAction('admin');
  if ('error' in auth) return privateRoleplayResponse({ error: 'Forbidden' }, { status: 403 });
  if (!(await matchesExplicitAdminBearer(req, auth.user.userId))) {
    return privateRoleplayResponse({ error: 'Forbidden' }, { status: 403 });
  }

  const quota = applyRateLimit(
    req, { ...RATE_LIMITS.audioUpload, maxRequests: 20, keyPrefix: 'happyscribe-list' },
    auth.user.userId,
  );
  if (!quota.success) return privateRoleplayResponse(
    { error: 'Demasiadas consultas a HappyScribe.' },
    { status: 429, headers: createRateLimitHeaders(quota) },
  );

  const config = await configuration();
  if (!config) return privateRoleplayResponse(
    { error: 'HappyScribe no está configurado. Añade HAPPY_SCRIBE_API_TOKEN y HAPPY_SCRIBE_ORGANIZATION_ID en el servidor.' },
    { status: 503 },
  );

  const page = Math.max(0, Math.min(1000, Number(req.nextUrl.searchParams.get('page') ?? 0) || 0));
  try {
    const upstream = await happyScribeFetch(
      `/transcriptions?organization_id=${encodeURIComponent(config.organizationId)}&page=${page}&per_page=50`,
      config.token, undefined, req.signal,
    );
    if (!upstream.ok) {
      const status = upstream.status === 401 || upstream.status === 403 ? 502
        : upstream.status === 429 ? 503 : 502;
      return privateRoleplayResponse(
        { error: upstream.status === 401 || upstream.status === 403
          ? 'HappyScribe rechazó las credenciales o el acceso a este espacio.'
          : upstream.status === 429 ? 'HappyScribe limitó temporalmente las consultas.' : 'No fue posible consultar HappyScribe.' },
        { status, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    const payload: unknown = await upstream.json();
    if (!payload || typeof payload !== 'object' || !('results' in payload) || !Array.isArray(payload.results)) {
      return privateRoleplayResponse({ error: 'HappyScribe devolvió una lista no válida.' }, { status: 502 });
    }
    const items = payload.results.flatMap((item: unknown) => {
      if (!item || typeof item !== 'object') return [];
      const row = item as Record<string, unknown>;
      if (typeof row.id !== 'string' || !isValidHappyScribeId(row.id)) return [];
      return [{
        id: row.id,
        importProof: issueHappyScribeImportProof({ id: row.id, organizationId: config.organizationId, userId: auth.user.userId, token: config.token }),
        name: typeof row.name === 'string' ? row.name.slice(0, 240) : 'Transcripción sin título',
        state: typeof row.state === 'string' ? row.state : 'unknown',
        language: typeof row.language === 'string' ? row.language : null,
        durationSeconds: typeof row.audioLengthInSeconds === 'number' ? row.audioLengthInSeconds : null,
        createdAt: typeof row.createdAt === 'string' ? row.createdAt : null,
        folder: row.folder && typeof row.folder === 'object' &&
          'name' in row.folder && typeof row.folder.name === 'string' ? row.folder.name : null,
      }];
    });
    return privateRoleplayResponse(
      { success: true, data: items, page, hasMore: Boolean((payload as { _links?: { next?: unknown } })._links?.next), mediaImportEnabled: config.mediaImportEnabled },
      { headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } },
    );
  } catch {
    return privateRoleplayResponse({ error: 'No fue posible conectar con HappyScribe.' }, { status: 502 });
  }
}

/** Admin-only transcript export. Never returns signed provider URLs to the client. */
export async function POST(req: NextRequest) {
  const auth = await validateAction('admin');
  if ('error' in auth) return privateRoleplayResponse({ error: 'Forbidden' }, { status: 403 });
  if (!(await matchesExplicitAdminBearer(req, auth.user.userId))) {
    return privateRoleplayResponse({ error: 'Forbidden' }, { status: 403 });
  }

  const quota = applyRateLimit(
    req, { ...RATE_LIMITS.audioUpload, maxRequests: 10, keyPrefix: 'happyscribe-export' },
    auth.user.userId,
  );
  if (!quota.success) return privateRoleplayResponse(
    { error: 'Has alcanzado el límite temporal de importaciones.' },
    { status: 429, headers: createRateLimitHeaders(quota) },
  );

  const config = await configuration();
  if (!config) return privateRoleplayResponse({ error: 'HappyScribe no está configurado en el servidor.' }, { status: 503 });

  let id = '';
  try {
    const body: unknown = await req.json();
    if (body && typeof body === 'object' && 'id' in body && typeof body.id === 'string') id = body.id;
    if (!isValidHappyScribeId(id)) return privateRoleplayResponse({ error: 'Identificador de transcripción no válido.' }, { status: 400 });
    const proof = body && typeof body === 'object' && 'proof' in body ? body.proof : null;
    if (!verifyHappyScribeImportProof({ id, organizationId: config.organizationId, userId: auth.user.userId, token: config.token }, proof)) {
      return privateRoleplayResponse({ error: 'Selección no verificada o caducada. Actualiza la biblioteca y vuelve a intentarlo.' }, { status: 403 });
    }

    const detailResponse = await happyScribeFetch(`/transcriptions/${id}`, config.token, undefined, req.signal);
    if (!detailResponse.ok) return privateRoleplayResponse(
      { error: detailResponse.status === 404 ? 'Transcripción no encontrada.' : 'No fue posible verificar la transcripción.' },
      { status: detailResponse.status === 404 ? 404 : 502 },
    );
    const detail: unknown = await detailResponse.json();
    if (!detail || typeof detail !== 'object' || !('state' in detail) ||
        !['automatic_done', 'done'].includes(String(detail.state))) {
      return privateRoleplayResponse({ error: 'La transcripción todavía no está lista para exportarse.' }, { status: 409 });
    }

    const createResponse = await happyScribeFetch('/exports', config.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ export: { format: 'srt', transcription_ids: [id] } }),
    }, req.signal);
    if (!createResponse.ok) return privateRoleplayResponse({ error: 'HappyScribe no pudo preparar el archivo SRT.' }, { status: 502 });
    const created: unknown = await createResponse.json();
    const exportId = created && typeof created === 'object' && 'id' in created && typeof created.id === 'string'
      ? created.id : null;
    if (!exportId || !isValidHappyScribeId(exportId)) return privateRoleplayResponse({ error: 'Respuesta de exportación no válida.' }, { status: 502 });

    let downloadLink: string | null = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      const statusResponse = await happyScribeFetch(`/exports/${exportId}`, config.token, undefined, req.signal);
      if (!statusResponse.ok) break;
      const status: unknown = await statusResponse.json();
      if (status && typeof status === 'object' && 'state' in status) {
        if (status.state === 'ready' && 'download_link' in status &&
            typeof status.download_link === 'string') {
          downloadLink = status.download_link;
          break;
        }
        if (status.state === 'failed' || status.state === 'expired') break;
      }
      await delay(1000, undefined, { signal: req.signal });
    }
    if (!downloadLink) return privateRoleplayResponse(
      { error: 'La exportación aún no está disponible. Inténtalo nuevamente en unos segundos.' },
      { status: 503, headers: { 'Retry-After': '5' } },
    );

    const parsedLink = new URL(downloadLink);
    if (!isAllowedHappyScribeExportUrl(parsedLink)) {
      return privateRoleplayResponse({ error: 'HappyScribe devolvió un destino de descarga no permitido.' }, { status: 502 });
    }
    // Follow only a small number of HTTPS redirects to approved provider or
    // AWS storage hosts; never let an allowed URL redirect to private services.
    const fileResponse = await fetchHappyScribeExport(downloadLink,
      AbortSignal.any([req.signal, AbortSignal.timeout(15_000)]));
    if (!fileResponse.ok) {
      await discardHappyScribeDownload(fileResponse);
      return privateRoleplayResponse({ error: 'No fue posible descargar el SRT desde HappyScribe.' }, { status: 502 });
    }
    const declaredLength = Number(fileResponse.headers.get('content-length') ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > 5_000_000) {
      await discardHappyScribeDownload(fileResponse);
      return privateRoleplayResponse({ error: 'El SRT supera el tamaño admitido.' }, { status: 413 });
    }
    if (!fileResponse.body) return privateRoleplayResponse({ error: 'La descarga SRT está vacía.' }, { status: 502 });
    const reader = fileResponse.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > 5_000_000) {
        try { await reader.cancel(); } catch { /* Preserve 413 if upstream cleanup fails. */ }
        return privateRoleplayResponse({ error: 'El SRT supera el tamaño admitido.' }, { status: 413 });
      }
      chunks.push(value);
    }
    const merged = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(merged);
    if (!text.trim() || !text.includes('-->')) {
      return privateRoleplayResponse({ error: 'El SRT está vacío o supera el tamaño admitido.' }, { status: 502 });
    }
    return privateRoleplayResponse(
      { success: true, data: { filename: 'happyscribe-import.srt', content: text } },
      { headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } },
    );
  } catch {
    return privateRoleplayResponse({ error: 'No fue posible importar la transcripción desde HappyScribe.' }, { status: 502 });
  }
}
