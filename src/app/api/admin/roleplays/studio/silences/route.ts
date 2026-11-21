import { NextRequest } from 'next/server';
import { privateRoleplayResponse } from '@/lib/roleplay/private-response';
import { actorFromBearer } from '@/lib/api-auth';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { validateAction } from '@/lib/auth/actions';
import { applyRateLimit, createRateLimitHeaders, RATE_LIMITS } from '@/lib/security/rate-limit';
import { parseFinalFfmpegOutputSeconds } from '@/lib/roleplay-studio/ffmpeg-progress';
import { parseStudioSilences } from '@/lib/roleplay-studio/silence-analysis';
import { MultipartBodyTooLargeError, readBoundedMultipartFormData } from '@/lib/roleplay-studio/bounded-multipart';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_MP3_BYTES = 15 * 1024 * 1024;
// Keep the existing 100 KB multipart overhead allowance, but enforce it
// on actual streamed bytes, not just an optional Content-Length header.
const MAX_MULTIPART_BYTES = MAX_MP3_BYTES + 100_000;
const MAX_PROCESS_MS = 45_000;
const MAX_STDERR_BYTES = 256_000;
const MAX_STDOUT_BYTES = 32_000;
const MAX_ACTIVE_ANALYSES = 1; // Per Next.js process, not a distributed job quota.
let activeAnalyses = 0;

type SilenceAnalysis = {
  durationSeconds: number;
  silences: ReturnType<typeof parseStudioSilences>;
};

async function detectSilences(input: Buffer, signal: AbortSignal): Promise<SilenceAnalysis> {
  const executable = ffmpegPath;
  if (!executable) throw new Error('FFmpeg unavailable');
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, [
      '-hide_banner', '-loglevel', 'info', '-nostdin', '-nostats',
      '-progress', 'pipe:1',
      '-i', 'pipe:0', '-map', '0:a:0',
      '-af', 'silencedetect=noise=-32dB:d=0.65',
      '-f', 'null', '-',
    ], { stdio: 'pipe' });
    let stderr = '';
    let progress = '';
    let killedForSize = false;
    let timedOut = false;
    let settled = false;

    const onAbort = () => child.kill('SIGKILL');
    signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, MAX_PROCESS_MS);
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    };
    const fail = (reason: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(reason));
    };

    child.on('error', () => fail('FFmpeg execution failed'));
    child.stderr.on('data', (part: Buffer) => {
      stderr += part.toString('utf8');
      if (stderr.length > MAX_STDERR_BYTES) {
        killedForSize = true;
        child.kill('SIGKILL');
      }
    });
    child.stdout.on('data', (part: Buffer) => {
      progress = (progress + part.toString('utf8')).slice(-MAX_STDOUT_BYTES);
    });
    child.on('close', code => {
      cleanup();
      if (settled) return;
      if (code !== 0 || timedOut || signal.aborted || killedForSize) {
        fail('Audio analysis failed');
        return;
      }
      try {
        const durationSeconds = parseFinalFfmpegOutputSeconds(progress);
        if (durationSeconds === null || durationSeconds < 0.1 || durationSeconds > 7200) {
          fail('Audio duration invalid');
          return;
        }
        const silences = parseStudioSilences(stderr, durationSeconds);
        settled = true;
        resolve({ durationSeconds, silences });
      } catch {
        fail('Audio silence parsing failed');
      }
    });
    child.stdin.on('error', () => { /* Decoder failure is signaled by process exit. */ });
    child.stdin.end(input);
  });
}

/** CPU-bounded, admin-only signal analysis; no uploads, storage or transcription. */
export async function POST(req: NextRequest) {
  const auth = await validateAction('admin');
  if ('error' in auth) return privateRoleplayResponse({ error: 'Forbidden' }, { status: 403 });
  // When a Bearer is supplied, it must represent the same administrator as
  // the cookie-based action guard. Never charge quota or decode audio for a
  // mismatched identity, even when the Edge middleware verified the token.
  if (req.headers.has('authorization')) {
    const bearer = await actorFromBearer(req);
    if (!bearer || bearer.role !== 'admin' || bearer.userId !== auth.user.userId) {
      return privateRoleplayResponse({ error: 'Forbidden' }, { status: 403 });
    }
  }
  const quota = applyRateLimit(
    req,
    { ...RATE_LIMITS.audioUpload, maxRequests: 2, keyPrefix: 'studio-silence' },
    auth.user.userId,
  );
  if (!quota.success) {
    return privateRoleplayResponse({ error: 'Demasiados análisis de audio.' }, {
      status: 429, headers: { ...createRateLimitHeaders(quota), 'Cache-Control': 'private, no-store' },
    });
  }
  const declaredSize = Number(req.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredSize) && declaredSize > MAX_MULTIPART_BYTES) {
    return privateRoleplayResponse({ error: 'El MP3 supera 15 MiB.' }, { status: 413 });
  }
  if (activeAnalyses >= MAX_ACTIVE_ANALYSES) {
    return privateRoleplayResponse({ error: 'Hay otro análisis en curso. Inténtalo de nuevo.' }, {
      status: 503, headers: { 'Retry-After': '10', 'Cache-Control': 'private, no-store' },
    });
  }
  activeAnalyses++;
  try {
    if (req.signal.aborted) return privateRoleplayResponse({ error: 'Solicitud cancelada' }, { status: 499 });
    const data = await readBoundedMultipartFormData(req, MAX_MULTIPART_BYTES);
    const audio = data.get('audio');
    if (!(audio instanceof File) || audio.size < 1 || audio.size > MAX_MP3_BYTES ||
        !['', 'audio/mpeg', 'audio/mp3'].includes(audio.type) || !/\.mp3$/i.test(audio.name)) {
      return privateRoleplayResponse({ error: 'Selecciona un MP3 válido de hasta 15 MiB.' }, { status: 400 });
    }
    const result = await detectSilences(Buffer.from(await audio.arrayBuffer()), req.signal);
    return privateRoleplayResponse(
      {
        success: true,
        ...result,
        method: 'ffmpeg-silencedetect',
        minSilenceSeconds: 0.65,
        noiseThresholdDb: -32,
        notice: 'Las pausas no identifican idioma ni hablante. Verifica cada corte antes de exportar.',
      },
      { headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } },
    );
  } catch (error) {
    if (error instanceof MultipartBodyTooLargeError) {
      return privateRoleplayResponse({ error: 'El MP3 supera 15 MiB.' }, { status: 413 });
    }
    return privateRoleplayResponse(
      { error: 'No fue posible analizar las pausas. Revisa el MP3 y vuelve a intentarlo.' },
      { status: 422, headers: { 'Cache-Control': 'private, no-store' } },
    );
  } finally {
    activeAnalyses--;
  }
}
