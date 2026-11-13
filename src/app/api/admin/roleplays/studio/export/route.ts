import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import ffmpegPath from 'ffmpeg-static';
import { validateAction } from '@/lib/auth/actions';
import { applyRateLimit, createRateLimitHeaders, RATE_LIMITS } from '@/lib/security/rate-limit';
import { ROLEPLAY_MAX_SCENARIOS, ROLEPLAY_RESPONSE_MAX_DURATION_SEC } from '@/lib/roleplay-limits';
import { parseFinalFfmpegOutputSeconds } from '@/lib/roleplay-studio/ffmpeg-progress';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_INPUT_BYTES = 15 * 1024 * 1024;
const MAX_TOTAL_SECONDS = 900;
const MAX_METADATA_CHARS = 150_000;
const MAX_CONCURRENT_EXPORTS = 2; // Process-local admission control. Not a distributed quota.
const MAX_EXPORT_TIME_MS = 105_000;
const MAX_SEGMENT_TIME_MS = 15_000;
let activeExports = 0;

type Segment = { title: string; start: number; end: number; scriptPrompt: string; responseLimit: number };
type ZipEntry = { name: string; data: Buffer };

function parseSegments(value: string | null): Segment[] | null {
  if (!value || value.length > MAX_METADATA_CHARS) return null;
  let raw: unknown;
  try { raw = JSON.parse(value); } catch { return null; }
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > ROLEPLAY_MAX_SCENARIOS) return null;
  const result: Segment[] = [];
  let lastEnd = 0;
  let total = 0;
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const item = entry as Record<string, unknown>;
    const { title, start, end, scriptPrompt, responseLimit } = item;
    if (typeof title !== 'string' || title.trim().length < 1 || title.length > 200 ||
      typeof start !== 'number' || !Number.isFinite(start) ||
      typeof end !== 'number' || !Number.isFinite(end) ||
      start < 0 || end - start < 0.1 || end - start > 300 ||
      start < lastEnd || end > 7200 ||
      typeof scriptPrompt !== 'string' || scriptPrompt.length > 5000 ||
      typeof responseLimit !== 'number' || !Number.isSafeInteger(responseLimit) ||
      responseLimit < 0 || responseLimit > ROLEPLAY_RESPONSE_MAX_DURATION_SEC) return null;
    total += end - start;
    lastEnd = end;
    result.push({ title: title.trim(), start, end, scriptPrompt, responseLimit });
  }
  return total <= MAX_TOTAL_SECONDS ? result : null;
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Store-only ZIP: MP3 is already compressed. Avoid extra dependencies and temp files. */
function makeZip(entries: ZipEntry[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const filename = Buffer.from(entry.name, 'utf8');
    const checksum = crc32(entry.data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(entry.data.length, 18);
    header.writeUInt32LE(entry.data.length, 22);
    header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, entry.data);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x0800, 8);
    record.writeUInt32LE(checksum, 16);
    record.writeUInt32LE(entry.data.length, 20);
    record.writeUInt32LE(entry.data.length, 24);
    record.writeUInt16LE(filename.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, filename);
    offset += header.length + filename.length + entry.data.length;
  }
  const centralSize = central.reduce((sum, item) => sum + item.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

async function sliceMp3(input: Buffer, segment: Segment, deadline: number, signal: AbortSignal): Promise<Buffer> {
  const remaining = Math.min(MAX_SEGMENT_TIME_MS, deadline - Date.now());
  if (remaining <= 0 || signal.aborted) throw new Error('Export deadline exceeded');
  const executable = ffmpegPath;
  if (!executable) throw new Error('FFmpeg unavailable');
  return await new Promise<Buffer>((resolve, reject) => {
    const child = spawn(executable, [
      '-hide_banner', '-loglevel', 'error', '-nostdin',
      '-progress', 'pipe:2', '-nostats',
      '-i', 'pipe:0', '-ss', String(segment.start), '-t', String(segment.end - segment.start),
      '-vn', '-ac', '1', '-ar', '24000', '-codec:a', 'libmp3lame', '-b:a', '64k', '-f', 'mp3', 'pipe:1',
    ], { stdio: 'pipe' });
    const chunks: Buffer[] = [];
    let size = 0;
    let errorText = '';
    let settled = false;
    const abort = () => child.kill('SIGKILL');
    signal.addEventListener('abort', abort, { once: true });
    const cleanup = () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
    };
    const timeout = setTimeout(() => child.kill('SIGKILL'), remaining);
    const fail = (message: string) => {
      if (!settled) { settled = true; cleanup(); reject(new Error(message)); }
    };
    child.on('error', () => fail('FFmpeg execution failed'));
    // FFmpeg exits zero when the requested interval runs past EOF. Capture
    // its progress record to reject partial audio instead of exporting it.
    child.stderr.on('data', (chunk: Buffer) => { errorText = (errorText + chunk.toString()).slice(-8192); });
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_INPUT_BYTES) { child.kill('SIGKILL'); fail('Segment too large'); }
      else chunks.push(chunk);
    });
    child.on('close', (code) => {
      cleanup();
      if (settled) return;
      if (code !== 0 || size === 0) return fail('Invalid audio or FFmpeg failure: ' + errorText);
      const actualSeconds = parseFinalFfmpegOutputSeconds(errorText);
      const expectedSeconds = segment.end - segment.start;
      const tolerance = Math.min(0.25, Math.max(0.05, expectedSeconds * 0.1));
      if (actualSeconds === null || actualSeconds + tolerance < expectedSeconds) {
        return fail('El intervalo solicitado supera el audio real o FFmpeg no reportó su duración final');
      }
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    child.stdin.on('error', () => { /* FFmpeg handles invalid input via process exit. */ });
    child.stdin.end(input);
  });
}

export async function POST(req: NextRequest) {
  const auth = await validateAction('admin');
  if ('error' in auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  // A real authenticated actor is a more stable quota key than a proxy header.
  const limit = applyRateLimit(
    req,
    { ...RATE_LIMITS.audioUpload, maxRequests: 3, keyPrefix: 'studio-export' },
    auth.user.userId,
  );
  if (!limit.success) return NextResponse.json({ error: 'Demasiadas solicitudes de audio.' }, {
    status: 429, headers: createRateLimitHeaders(limit),
  });
  const contentLength = Number(req.headers.get('content-length') ?? 0);
  if (contentLength > MAX_INPUT_BYTES + 100000) {
    return NextResponse.json({ error: 'Audio exceeds 15 MiB' }, { status: 413 });
  }
  if (activeExports >= MAX_CONCURRENT_EXPORTS) {
    return NextResponse.json({ error: 'El estudio está ocupado. Inténtalo de nuevo en unos momentos.' }, { status: 503, headers: { 'Retry-After': '10' } });
  }
  activeExports++;
  const deadline = Date.now() + MAX_EXPORT_TIME_MS;
  try {
    if (req.signal.aborted) return NextResponse.json({ error: 'Solicitud cancelada' }, { status: 499 });
    const form = await req.formData();
    const audio = form.get('audio');
    const segments = parseSegments(typeof form.get('segments') === 'string' ? form.get('segments') as string : null);
    if (!(audio instanceof File) || audio.size < 1 || audio.size > MAX_INPUT_BYTES ||
      !['audio/mpeg', 'audio/mp3', ''].includes(audio.type) || !/\.mp3$/i.test(audio.name) || !segments) {
      return NextResponse.json({ error: 'Invalid MP3 or segment boundaries' }, { status: 400 });
    }
    const input = Buffer.from(await audio.arrayBuffer());
    const entries: ZipEntry[] = [];
    const manifest = { version: 1, generator: 'interpretes-rd-roleplay-studio', segments: [] as Array<Record<string, unknown>> };
    for (const [index, segment] of segments.entries()) {
      const data = await sliceMp3(input, segment, deadline, req.signal);
      const file = 'segment-' + String(index + 1).padStart(2, '0') + '.mp3';
      entries.push({ name: file, data });
      manifest.segments.push({
        order: index, title: segment.title, file, size_bytes: data.length,
        sha256: createHash('sha256').update(data).digest('hex'),
        duration_limit_sec: segment.responseLimit, script_prompt: segment.scriptPrompt,
      });
    }
    entries.unshift({ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2)) });
    const archive = makeZip(entries);
    return new NextResponse(new Uint8Array(archive), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="roleplay-studio.zip"',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('[ROLEPLAY STUDIO] Export failed:', error instanceof Error ? error.message : 'Unexpected error');
    if (error instanceof Error && error.message.startsWith('El intervalo solicitado supera el audio real')) {
      return NextResponse.json({ error: 'Una intervención termina después del audio original. Revisa su inicio y final antes de exportar.' }, { status: 422 });
    }
    return NextResponse.json({ error: 'No se pudo procesar el audio. Revisa el formato y la duración.' }, { status: 422 });
  } finally {
    activeExports--;
  }
}
