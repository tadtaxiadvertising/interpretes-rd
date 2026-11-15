// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  validateAction: vi.fn(),
  actorFromBearer: vi.fn(),
  requeue: vi.fn(),
}));

vi.mock('@/lib/auth/actions', () => ({ validateAction: m.validateAction }));
vi.mock('@/lib/api-auth', () => ({ actorFromBearer: m.actorFromBearer }));
vi.mock('@/app/actions/roleplay-audio', () => ({
  requeueFailedRoleplayAudioJob: m.requeue,
}));

import { POST } from './route';

const context = () => ({ params: Promise.resolve({ id: 'audio-job-1' }) });
const request = (authorization?: string) => new Request(
  'http://localhost/api/admin/roleplay-audio-jobs/audio-job-1/requeue',
  { method: 'POST', headers: authorization ? { authorization } : {} },
);

describe('POST /api/admin/roleplay-audio-jobs/[id]/requeue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.validateAction.mockResolvedValue({
      user: { userId: 'admin-1', role: 'admin' },
      profile: { userId: 'admin-1', role: 'admin' },
    });
    m.requeue.mockResolvedValue({ success: true, jobId: 'audio-job-1' });
  });

  it('retains cookie-only admin requeue with private response', async () => {
    const res = await POST(request() as never, context());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { jobId: 'audio-job-1' } });
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('Vary')).toContain('Cookie');
    expect(m.requeue).toHaveBeenCalledWith({ jobId: 'audio-job-1' });
    expect(m.actorFromBearer).not.toHaveBeenCalled();
  });

  it.each([
    ['interpreter', { userId: 'interpreter-2', role: 'interpreter' }],
    ['different administrator', { userId: 'other-admin', role: 'admin' }],
    ['expired token', null],
  ])('rejects mismatched explicit %s credentials before changing job state', async (_reason, bearer) => {
    m.actorFromBearer.mockResolvedValueOnce(bearer);
    const res = await POST(request('Bearer explicit-credential') as never, context());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('Forbidden');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(m.requeue).not.toHaveBeenCalled();
  });

  it('permits a verified Bearer only when it matches the admin cookie identity', async () => {
    m.actorFromBearer.mockResolvedValueOnce({ userId: 'admin-1', role: 'admin' });
    const res = await POST(request('Bearer matching-admin-token') as never, context());
    expect(res.status).toBe(200);
    expect(m.requeue).toHaveBeenCalledOnce();
  });

  it('rejects non-admin cookies before reading the job even with explicit Authorization', async () => {
    m.validateAction.mockResolvedValueOnce({ error: 'Access denied: private-id', code: 'UNAUTHORIZED' });
    const res = await POST(request('Bearer matching-admin-token') as never, context());
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).not.toContain('private-id');
    expect(m.actorFromBearer).not.toHaveBeenCalled();
    expect(m.requeue).not.toHaveBeenCalled();
  });

  it('does not cache a failed state transition', async () => {
    m.requeue.mockResolvedValueOnce({ success: false, code: 'CONFLICT', error: 'Job state changed' });
    const res = await POST(request() as never, context());
    expect(res.status).toBe(409);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('Vary')).toContain('Cookie');
  });
});
