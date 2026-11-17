import { NextRequest } from 'next/server';
import { fetchHappyScribeExport, isAllowedHappyScribeExportUrl } from '@/lib/roleplay/happyscribe-download';
import { isValidHappyScribeId } from '@/lib/roleplay/happyscribe-id';
import { validateAction } from '@/lib/auth/actions';
import { privateRoleplayResponse } from '@/lib/roleplay/private-response';
import { applyRateLimit, createRateLimitHeaders, RATE_LIMITS } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 120;

const API_BASE = 'https://www.happyscribe.com/api/v1';
const MAX_MEDIA_BYTES = 250 * 1024 * 1024;

async function happyScribeFetch(path: string, token: string, init?: RequestInit) {
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
}

/** Admin-only, bounded MP3 import. The signed provider URL never reaches the browser. */
export async function POST(req: NextRequest) {
  const auth = await validateAction('admin');
  if ('error' in auth) return privateRoleplayResponse({ success: false, error: 'Forbidden' }, { status: 403 });

  // Audio transits this frontend VPS. Keep the potentially expensive transfer
  // disabled until an operator explicitly accepts bandwidth/privacy costs.
  if (process.env.HAPPY_SCRIBE_MEDIA_PROXY_ENABLED !== 'true') {
    return privateRoleplayResponse(
      { success: false, error: 'La importación directa de audio está desactivada. Descarga la grabación y selecciónala localmente.' },
      { status: 503 },
    );
  }

  const quota = applyRateLimit(
    req, { ...RATE_LIMITS.audioUpload, maxRequests: 3, keyPrefix: 'happyscribe-media' },
    auth.user.userId,
  );
  if (!quota.success) return privateRoleplayResponse(
    { success: false, error: 'Has alcanzado el límite temporal de importaciones de audio.' },
    { status: 429, headers: createRateLimitHeaders(quota) },
  );

  const token = process.env.HAPPY_SCRIBE_API_TOKEN?.trim();
  if (!token) return privateRoleplayResponse(
    { success: false, error: 'HappyScribe no está configurado en el servidor.' }, { status: 503 },
  );

  try {
    const body: unknown = await req.json();
    const id = body && typeof body === 'object' && 'id' in body && typeof body.id === 'string'
      ? body.id : '';
    if (!isValidHappyScribeId(id)) return privateRoleplayResponse(
      { success: false, error: 'Identificador de transcripción no válido.' }, { status: 400 },
    );

    const detailResponse = await happyScribeFetch(`/transcriptions/${id}`, token);
    if (!detailResponse.ok) return privateRoleplayResponse(
      { success: false, error: detailResponse.status === 404
        ? 'Transcripción no encontrada.' : 'No fue posible verificar el archivo en HappyScribe.' },
      { status: detailResponse.status === 404 ? 404 : 502 },
    );
    const detail: unknown = await detailResponse.json();
    if (!detail || typeof detail !== 'object' || !('state' in detail) ||
        detail.state !== 'automatic_done') {
      return privateRoleplayResponse(
        { success: false, error: 'El audio solo está disponible cuando HappyScribe termina de procesar la transcripción.' },
        { status: 409 },
      );
    }

    const exportResponse = await happyScribeFetch('/exports', token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ export: { format: 'mp3', transcription_ids: [id] } }),
    });
    if (!exportResponse.ok) return privateRoleplayResponse(
      { success: false, error: 'HappyScribe no pudo preparar el audio original.' }, { status: 502 },
    );
    const exported: unknown = await exportResponse.json();
    const downloadLink = exported && typeof exported === 'object' &&
      'download_link' in exported && typeof exported.download_link === 'string'
      ? exported.download_link : null;
    const exportState = exported && typeof exported === 'object' && 'state' in exported
      ? exported.state : null;
    if (exportState !== 'ready' || !downloadLink) return privateRoleplayResponse(
      { success: false, error: 'HappyScribe no devolvió el audio listo para descargar.' }, { status: 503 },
    );

    const parsedUrl = new URL(downloadLink);
    if (!isAllowedHappyScribeExportUrl(parsedUrl)) return privateRoleplayResponse(
      { success: false, error: 'HappyScribe devolvió un destino de descarga no permitido.' }, { status: 502 },
    );
    // A cancelled browser download should stop the upstream provider transfer
    // rather than continuing to consume the server's bandwidth.
    const transferSignal = AbortSignal.any([req.signal, AbortSignal.timeout(90_000)]);
    const media = await fetchHappyScribeExport(downloadLink, transferSignal);
    if (!media.ok || !media.body) return privateRoleplayResponse(
      { success: false, error: 'No fue posible descargar el audio desde HappyScribe.' }, { status: 502 },
    );

    const declaredLength = Number(media.headers.get('content-length') ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_MEDIA_BYTES) {
      await media.body.cancel();
      return privateRoleplayResponse(
        { success: false, error: 'El audio supera el límite de importación directa de 250 MiB. Descárgalo desde HappyScribe y cárgalo localmente.' },
        { status: 413 },
      );
    }

    const reader = media.body.getReader();
    let totalBytes = 0;
    const boundedStream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            return;
          }
          totalBytes += value.byteLength;
          if (totalBytes > MAX_MEDIA_BYTES) {
            await reader.cancel();
            controller.error(new Error('HappyScribe media exceeded the import size limit'));
            return;
          }
          controller.enqueue(value);
        } catch {
          controller.error(new Error('HappyScribe media stream failed'));
        }
      },
      async cancel() {
        await reader.cancel();
      },
    });

    return new Response(boundedStream, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Disposition': 'attachment; filename="happyscribe-audio.mp3"',
        ...(Number.isFinite(declaredLength) && declaredLength > 0
          ? { 'Content-Length': String(declaredLength) } : {}),
        'Cache-Control': 'private, no-store',
        Vary: 'Cookie, Authorization',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return privateRoleplayResponse(
      { success: false, error: 'No fue posible importar el audio desde HappyScribe.' },
      { status: 502 },
    );
  }
}
