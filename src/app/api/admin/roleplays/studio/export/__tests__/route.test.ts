// @vitest-environment node
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
    expect(applyRateLimit).not.toHaveBeenCalled();
  });

  it('rate-limits CPU-intensive audio jobs', async () => {
    vi.mocked(applyRateLimit).mockReturnValue({ success: false } as never);
    const result = await POST(request([validSegment]) as never);
    expect(result.status).toBe(429);
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
