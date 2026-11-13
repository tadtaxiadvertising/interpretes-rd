// @vitest-environment node
import { spawnSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/actions', () => ({ validateAction: vi.fn() }));
vi.mock('@/lib/security/rate-limit', () => ({
  applyRateLimit: vi.fn(),
  createRateLimitHeaders: vi.fn(() => ({})),
  RATE_LIMITS: { audioUpload: {} },
}));

import { POST } from '../route';
import { validateAction } from '@/lib/auth/actions';
import { applyRateLimit } from '@/lib/security/rate-limit';

function request(file = new File(['NOT-MP3'], 'recording.mp3', { type: 'audio/mpeg' })) {
  const data = new FormData();
  data.append('audio', file);
  return new Request('http://localhost/api/admin/roleplays/studio/silences', {
    method: 'POST', body: data,
  });
}

describe('admin FFmpeg silence analysis boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateAction).mockResolvedValue({
      user: { userId: 'admin', role: 'admin' },
      profile: { role: 'admin' },
    } as never);
    vi.mocked(applyRateLimit).mockReturnValue({ success: true } as never);
  });

  it('never parses audio or applies rate limiting for a participant', async () => {
    vi.mocked(validateAction).mockResolvedValue({ error: 'Forbidden', code: 'UNAUTHORIZED' });
    const result = await POST(request() as never);
    expect(result.status).toBe(403);
    expect(applyRateLimit).not.toHaveBeenCalled();
  });

  it('rate-limits CPU-intensive analyses', async () => {
    vi.mocked(applyRateLimit).mockReturnValue({ success: false } as never);
    const result = await POST(request() as never);
    expect(result.status).toBe(429);
  });

  it('rejects non-MP3 and oversize requests without running FFmpeg', async () => {
    expect((await POST(request(new File(['RIFF'], 'recording.wav', {
      type: 'audio/wav',
    })) as never)).status).toBe(400);
    const large = new File([new Uint8Array(15 * 1024 * 1024 + 1)], 'recording.mp3', {
      type: 'audio/mpeg',
    });
    expect((await POST(request(large) as never)).status).toBe(400);
  });

  it('does not leak FFmpeg decoding errors or malformed audio metadata to the caller', async () => {
    const result = await POST(request() as never);
    const body = await result.json();
    expect(result.status).toBe(422);
    expect(body.error).toMatch(/No fue posible analizar/);
    expect(JSON.stringify(body)).not.toContain('ffmpeg');
    expect(result.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('analyzes a real synthetic silent MP3 without retaining the original recording', async () => {
    if (!ffmpegPath) throw new Error('ffmpeg-static binary missing in test environment');
    const audio = spawnSync(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-nostdin',
      '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono',
      '-t', '3', '-c:a', 'libmp3lame', '-b:a', '64k',
      '-f', 'mp3', 'pipe:1',
    ], { maxBuffer: 2_000_000, timeout: 15_000 });
    expect(audio.status).toBe(0);
    const mp3 = new File([new Uint8Array(audio.stdout)], 'silence.mp3', { type: 'audio/mpeg' });
    const response = await POST(request(mp3) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.method).toBe('ffmpeg-silencedetect');
    expect(body.durationSeconds).toBeGreaterThan(2.8);
    expect(body.durationSeconds).toBeLessThan(3.3);
    expect(body.silences).toEqual([expect.objectContaining({ start: 0 })]);
    expect(body.silences[0].end).toBeGreaterThan(2.8);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(JSON.stringify(body)).not.toContain('recording.mp3');
  });
});
