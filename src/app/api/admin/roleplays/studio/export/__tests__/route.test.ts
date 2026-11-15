// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/actions', () => ({ validateAction: vi.fn() }));
vi.mock('@/lib/api-auth', () => ({ actorFromBearer: vi.fn() }));
vi.mock('@/lib/security/rate-limit', () => ({
  applyRateLimit: vi.fn(),
  createRateLimitHeaders: vi.fn(() => ({})),
  RATE_LIMITS: { audioUpload: {} },
}));

import { POST } from '../route';
import { validateAction } from '@/lib/auth/actions';
import { actorFromBearer } from '@/lib/api-auth';
import { applyRateLimit } from '@/lib/security/rate-limit';

const validSegment = {
  title: 'Consulta médica', start: 0, end: 12,
  scriptPrompt: 'Interpretar', responseLimit: 120,
};

function request(segments: unknown, file = new File(['ID3'], 'recording.mp3', { type: 'audio/mpeg' })) {
  const form = new FormData();
  form.append('audio', file);
  form.append('segments', JSON.stringify(segments));
  return new Request('http://localhost/api/admin/roleplays/studio/export', { method: 'POST', body: form });
}

describe('admin roleplay studio export security and input boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateAction).mockResolvedValue({ user: { role: 'admin' }, profile: { role: 'admin' } } as never);
    vi.mocked(applyRateLimit).mockReturnValue({ success: true } as never);
  });

  it('rejects a participant role before parsing multipart input', async () => {
    vi.mocked(validateAction).mockResolvedValue({ error: 'Forbidden', code: 'UNAUTHORIZED' });
    const result = await POST(request([validSegment]) as never);
    expect(result.status).toBe(403);
    expect(result.headers.get('Cache-Control')).toBe('private, no-store');
    expect(result.headers.get('Vary')).toBe('Cookie');
    expect(applyRateLimit).not.toHaveBeenCalled();
  });

  it.each([
    ['interpreter', { userId: 'interpreter-1', role: 'interpreter' }],
    ['different admin', { userId: 'admin-other', role: 'admin' }],
    ['invalid Bearer', null],
  ])('rejects mismatched %s Bearer before decoding or applying the export quota', async (_label, bearer) => {
    vi.mocked(validateAction).mockResolvedValue({
      user: { userId: 'admin-export', role: 'admin' },
      profile: { userId: 'admin-export', role: 'admin' },
    } as never);
    vi.mocked(actorFromBearer).mockResolvedValue(bearer as never);
    const req = request([validSegment]);
    req.headers.set('Authorization', 'Bearer supplied-token');
    const form = vi.spyOn(req, 'formData');
    const result = await POST(req as never);
    expect(result.status).toBe(403);
    expect(result.headers.get('Cache-Control')).toBe('private, no-store');
    expect(result.headers.get('Vary')).toContain('Cookie');
    expect(applyRateLimit).not.toHaveBeenCalled();
    expect(form).not.toHaveBeenCalled();
  });

  it('accepts a matching verified admin Bearer and proceeds to input validation', async () => {
    vi.mocked(validateAction).mockResolvedValue({
      user: { userId: 'admin-export', role: 'admin' },
      profile: { userId: 'admin-export', role: 'admin' },
    } as never);
    vi.mocked(actorFromBearer).mockResolvedValue({ userId: 'admin-export', role: 'admin' } as never);
    const req = request([]);
    req.headers.set('Authorization', 'Bearer same-admin-token');
    const result = await POST(req as never);
    expect(result.status).toBe(400);
    expect(applyRateLimit).toHaveBeenCalledOnce();
  });

  it('rate-limits CPU-intensive audio jobs', async () => {
    vi.mocked(applyRateLimit).mockReturnValue({ success: false } as never);
    const result = await POST(request([validSegment]) as never);
    expect(result.status).toBe(429);
    expect(result.headers.get('Cache-Control')).toBe('private, no-store');
    expect(result.headers.get('Vary')).toBe('Cookie');
  });

  it.each([
    [[],'empty list'],
    [[{ ...validSegment, end: 301 }], 'overlong segment'],
    [[{ ...validSegment, start: -1 }], 'negative start'],
    [[{ ...validSegment, title: '' }], 'empty title'],
    [[{ ...validSegment, scriptPrompt: 'a'.repeat(5001) }], 'long instructions'],
    [[{ ...validSegment, responseLimit: 301 }], 'excessive response limit'],
    [[validSegment, { ...validSegment, start: 11, end: 20 }], 'overlapping segments'],
    [[{ ...validSegment, start: Number.NaN }], 'invalid start'],
    [Array.from({ length: 26 }, (_, i) => ({ ...validSegment, start: i * 12, end: i * 12 + 12 })), 'too many segments'],
  ])('rejects invalid boundary: %s (%s)', async (segments) => {
    const result = await POST(request(segments) as never);
    expect(result.status).toBe(400);
  });

  it('never logs private diagnostic messages from failed export decoding', async () => {
    const req = request([validSegment]);
    const error = new Error('PRIVATE_AUDIO_TOKEN /tmp/medical-interpreting.mp3');
    error.name = 'PRIVATE_ERROR_NAME';
    vi.spyOn(req, 'formData').mockRejectedValueOnce(error);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await POST(req as never);
      const body = await res.json();
      expect(res.status).toBe(422);
      expect(JSON.stringify(body)).not.toContain('PRIVATE_AUDIO_TOKEN');
      expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_');
      expect(log).toHaveBeenCalledWith('[ROLEPLAY STUDIO] Export failed:', 'Error');
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
      expect(res.headers.get('Vary')).toBe('Cookie');
    } finally {
      log.mockRestore();
    }
  });

  it('rejects audio with the wrong extension', async () => {
    const result = await POST(request([validSegment], new File(['audio'], 'recording.wav', { type: 'audio/wav' })) as never);
    expect(result.status).toBe(400);
  });

  it('rejects files larger than the 15 MiB limit', async () => {
    const file = new File([new Uint8Array(15 * 1024 * 1024 + 1)], 'recording.mp3', { type: 'audio/mpeg' });
    const result = await POST(request([validSegment], file) as never);
    expect(result.status).toBe(400);
  });
});
