import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  actor: null as any,
  audioJobFindUnique: vi.fn(),
  audioJobUpdateMany: vi.fn(),
  responseUpdateMany: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

vi.mock('@/lib/auth/actions', () => ({
  validateAction: async (role?: string | string[]) => {
    const roles = Array.isArray(role) ? role : role ? [role] : [];
    if (!m.actor) return { error: 'Not authenticated', code: 'UNAUTHORIZED' };
    if (roles.length && !roles.includes(m.actor.role)) {
      return { error: 'Access denied: insufficient permissions', code: 'UNAUTHORIZED' };
    }
    return { user: m.actor, profile: m.actor };
  },
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    roleplayAudioJob: { findUnique: m.audioJobFindUnique, updateMany: m.audioJobUpdateMany },
    roleplayResponse: { updateMany: m.responseUpdateMany },
    $transaction: async (cb: any) => cb({
      roleplayAudioJob: { updateMany: m.audioJobUpdateMany },
      roleplayResponse: { updateMany: m.responseUpdateMany },
    }),
  },
}));

import { requeueFailedRoleplayAudioJob } from '@/app/actions/roleplay-audio';

const ADMIN = { role: 'admin', userId: 'admin-1' };
const FAILED_JOB = {
  id: 'job-1',
  status: 'FAILED',
  scenarioId: 'scn-1',
  sourceAudioPath: 'responses/s/s/1.webm',
};

beforeEach(() => {
  vi.clearAllMocks();
  m.actor = ADMIN;
  m.audioJobFindUnique.mockResolvedValue(FAILED_JOB);
  m.audioJobUpdateMany.mockResolvedValue({ count: 1 });
  m.responseUpdateMany.mockResolvedValue({ count: 1 });
});

describe('requeueFailedRoleplayAudioJob', () => {
  it('rejects non-admin callers', async () => {
    m.actor = { role: 'interpreter', userId: 'u-1' };
    const res = await requeueFailedRoleplayAudioJob({ jobId: 'job-1' });
    expect(res.success).toBe(false);
    expect(res.code).toBe('UNAUTHORIZED');
    expect(m.audioJobUpdateMany).not.toHaveBeenCalled();
  });

  it('rejects an invalid job id', async () => {
    const res = await requeueFailedRoleplayAudioJob({ jobId: '' });
    expect(res.success).toBe(false);
    expect(res.code).toBe('VALIDATION_ERROR');
  });

  it('returns NOT_FOUND for an unknown job', async () => {
    m.audioJobFindUnique.mockResolvedValue(null);
    const res = await requeueFailedRoleplayAudioJob({ jobId: 'missing' });
    expect(res.success).toBe(false);
    expect(res.code).toBe('NOT_FOUND');
  });

  it('refuses to requeue a job that is not FAILED', async () => {
    m.audioJobFindUnique.mockResolvedValue({ ...FAILED_JOB, status: 'COMPLETED' });
    const res = await requeueFailedRoleplayAudioJob({ jobId: 'job-1' });
    expect(res.success).toBe(false);
    expect(res.code).toBe('CONFLICT');
    expect(m.audioJobUpdateMany).not.toHaveBeenCalled();
  });

  it('requeues a FAILED job and resets its response to UPLOADED', async () => {
    const res = await requeueFailedRoleplayAudioJob({ jobId: 'job-1' });
    expect(res.success).toBe(true);
    expect(res.jobId).toBe('job-1');
    expect(m.audioJobUpdateMany).toHaveBeenCalledWith({
      where: { id: 'job-1', status: 'FAILED' },
      data: {
        status: 'PENDING',
        attempts: 0,
        availableAt: expect.any(Date),
        lockedAt: null,
        lockedBy: null,
        lastError: null,
        completedAt: null,
      },
    });
    expect(m.responseUpdateMany).toHaveBeenCalledWith({
      where: { scenarioId: 'scn-1', sourceAudioPath: 'responses/s/s/1.webm' },
      data: { audioStatus: 'UPLOADED', processingError: null },
    });
  });

  it('returns CONFLICT if the compare-and-set loses the race', async () => {
    m.audioJobUpdateMany.mockResolvedValue({ count: 0 });
    const res = await requeueFailedRoleplayAudioJob({ jobId: 'job-1' });
    expect(res.success).toBe(false);
    expect(res.code).toBe('CONFLICT');
  });
});
