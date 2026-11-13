// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import ffmpegPath from 'ffmpeg-static';

vi.mock('@/lib/auth/actions', () => ({
  validateAction: vi.fn(async () => ({
    user: { userId: 'admin-export-test', role: 'admin' },
    profile: { userId: 'admin-export-test', role: 'admin' },
  })),
}));
vi.mock('@/lib/security/rate-limit', () => ({
  applyRateLimit: vi.fn(() => ({ success: true, remaining: 2, resetAt: Date.now() + 1000 })),
  createRateLimitHeaders: vi.fn(() => ({})),
  RATE_LIMITS: { audioUpload: { maxRequests: 10, windowMs: 60000, keyPrefix: 'audio' } },
}));

import { POST } from '../route';

function readStoredZip(buffer: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let position = 0;
  while (position + 30 <= buffer.length && buffer.readUInt32LE(position) === 0x04034b50) {
    const bytes = buffer.readUInt32LE(position + 18);
    const nameBytes = buffer.readUInt16LE(position + 26);
    const extraBytes = buffer.readUInt16LE(position + 28);
    const filenameStart = position + 30;
    const dataStart = filenameStart + nameBytes + extraBytes;
    if (dataStart + bytes > buffer.length) throw new Error('Truncated ZIP entry');
    const filename = buffer.toString('utf8', filenameStart, filenameStart + nameBytes);
    entries.set(filename, buffer.subarray(dataStart, dataStart + bytes));
    position = dataStart + bytes;
  }
  expect(buffer.readUInt32LE(position)).toBe(0x02014b50); // central directory
  return entries;
}

describe('Audio Studio creates a real, re-importable MP3 archive', () => {
  it('exports a ZIP manifest whose SHA-256 and size match playable audio clips', async () => {
    expect(ffmpegPath).toBeTruthy();
    const source = spawnSync(ffmpegPath!, [
      '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
      '-i', 'sine=frequency=660:duration=3',
      '-codec:a', 'libmp3lame', '-b:a', '64k', '-f', 'mp3', 'pipe:1',
    ], { maxBuffer: 2 * 1024 * 1024, timeout: 15_000 });
    expect(source.status).toBe(0);
    expect(source.stdout.length).toBeGreaterThan(100);

    const segments = [
      { title: 'English', start: 0, end: 1.2, scriptPrompt: 'Listen carefully', responseLimit: 120 },
      { title: 'Español', start: 1.2, end: 2.5, scriptPrompt: 'Interpreta fielmente', responseLimit: 180 },
    ];
    const form = new FormData();
    form.append('audio', new File([new Uint8Array(source.stdout)], 'recording.mp3', { type: 'audio/mpeg' }));
    form.append('segments', JSON.stringify(segments));
    const request = new Request('http://localhost/api/admin/roleplays/studio/export', { method: 'POST', body: form });

    const result = await POST(request as never);
    expect(result.status).toBe(200);
    expect(result.headers.get('content-type')).toBe('application/zip');
    const zip = readStoredZip(Buffer.from(await result.arrayBuffer()));
    expect([...zip.keys()]).toEqual(['manifest.json', 'segment-01.mp3', 'segment-02.mp3']);

    const manifest = JSON.parse(zip.get('manifest.json')!.toString('utf8')) as {
      segments: Array<{ order: number; file: string; title: string; size_bytes: number; sha256: string; duration_limit_sec: number; script_prompt: string }>;
    };
    expect(manifest.segments).toHaveLength(2);
    for (const [index, entry] of manifest.segments.entries()) {
      const audio = zip.get(entry.file);
      expect(audio).toBeDefined();
      expect(entry.order).toBe(index);
      expect(entry.title).toBe(segments[index].title);
      expect(entry.script_prompt).toBe(segments[index].scriptPrompt);
      expect(entry.duration_limit_sec).toBe(segments[index].responseLimit);
      expect(entry.size_bytes).toBe(audio!.length);
      expect(entry.sha256).toBe(createHash('sha256').update(audio!).digest('hex'));
      const decoded = spawnSync(ffmpegPath!, [
        '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0',
        '-f', 's16le', '-ac', '1', '-ar', '24000', 'pipe:1',
      ], { input: audio, maxBuffer: 2 * 1024 * 1024, timeout: 15_000 });
      expect(decoded.status).toBe(0);
      expect(decoded.stdout.length).toBeGreaterThan(1000);
    }
  }, 60_000);

  it('rejects a partially truncated interval even when FFmpeg exits successfully', async () => {
    const source = spawnSync(ffmpegPath!, [
      '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
      '-i', 'sine=frequency=440:duration=3',
      '-codec:a', 'libmp3lame', '-b:a', '64k', '-f', 'mp3', 'pipe:1',
    ], { maxBuffer: 2 * 1024 * 1024, timeout: 15_000 });
    expect(source.status).toBe(0);

    const form = new FormData();
    form.append('audio', new File([new Uint8Array(source.stdout)], 'recording.mp3', { type: 'audio/mpeg' }));
    // Starts inside the 3-second recording but requests 2 seconds: only ~0.5
    // seconds would be encoded without the final progress check.
    form.append('segments', JSON.stringify([
      { title: 'Invalid trailing clip', start: 2.5, end: 4.5, scriptPrompt: '', responseLimit: 120 },
    ]));
    const request = new Request('http://localhost/api/admin/roleplays/studio/export', { method: 'POST', body: form });
    const response = await POST(request as never);
    expect(response.status).toBe(422);
    expect(response.headers.get('content-type')).toContain('application/json');
  }, 60_000);
});
