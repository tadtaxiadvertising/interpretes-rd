// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ findMany: vi.fn(), createMany: vi.fn(), findJobs: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: { userProfile: { findMany: m.findMany }, notification: { createMany: m.createMany }, roleplayAudioJob: { findMany: m.findJobs } } }));
import { notifyAudioJobFailures, reconcileAudioJobNotifications } from './notify-audio-job-failures';

const failure = { id: 'job-1', failedAt: new Date('2026-11-25T20:00:00Z') };
const admins = [{ id: '123e4567-e89b-42d3-a456-426614174000' }, { id: '48fb69c9-2ea0-497b-b599-bfd1845ea812' }];

beforeEach(() => {
  vi.resetAllMocks();
  m.findMany.mockResolvedValue(admins);
  m.createMany.mockResolvedValue({ count: 2 });
});

describe('terminal audio job alerts', () => {
  it('does no database work when there are no committed terminal failures', async () => {
    await notifyAudioJobFailures([]);
    expect(m.findMany).not.toHaveBeenCalled();
    expect(m.createMany).not.toHaveBeenCalled();
  });

  it('targets admin profiles and links to the actual audio queue without exposing job details', async () => {
    await notifyAudioJobFailures([failure]);
    expect(m.findMany).toHaveBeenCalledWith({ where: { role: { equals: 'admin', mode: 'insensitive' } }, select: { id: true } });
    expect(m.createMany).toHaveBeenCalledWith({
      data: admins.map(admin => expect.objectContaining({
        userId: admin.id, category: 'roleplay', type: 'error',
        link: '/admin/roleplay-audio-jobs', title: 'Procesamiento de audio fallido',
      })),
      skipDuplicates: true,
    });
    expect(JSON.stringify(m.createMany.mock.calls)).not.toContain('job-1');
  });

  it('deduplicates a replayed failure but distinguishes a later terminal failure', async () => {
    await notifyAudioJobFailures([failure]);
    await notifyAudioJobFailures([failure]);
    await notifyAudioJobFailures([{ ...failure, failedAt: new Date('2026-11-25T21:00:00Z') }]);
    const rows = m.createMany.mock.calls.map(call => call[0].data);
    expect(rows[0]).toEqual(rows[1]);
    expect(rows[2][0].id).not.toBe(rows[0][0].id);
    expect(rows[0][0].id).not.toBe(rows[0][1].id);
  });

  it('bounds each insert batch to 100 records', async () => {
    await notifyAudioJobFailures(Array.from({ length: 51 }, (_, i) => ({ ...failure, id: 'job-' + i })));
    expect(m.createMany.mock.calls.map(call => call[0].data.length)).toEqual([100, 2]);
  });

  it('does not propagate failed notification delivery or expose database details', async () => {
    m.createMany.mockRejectedValueOnce(new Error('PRIVATE_PASSWORD'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(notifyAudioJobFailures([failure])).resolves.toBe(false);
      expect(warn).toHaveBeenCalled();
      expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE_PASSWORD');
    } finally { warn.mockRestore(); }
  });
});

describe('terminal audio notification reconciliation', () => {
  const now = Date.parse('2026-11-25T21:00:00Z');

  it('selects only recent failed jobs with a bounded projection and never mutates jobs', async () => {
    m.findJobs.mockResolvedValueOnce([{ id: failure.id, updatedAt: failure.failedAt }]);
    expect(await reconcileAudioJobNotifications(null, now)).toBeNull();
    expect(m.findJobs).toHaveBeenCalledExactlyOnceWith({
      where: { status: 'FAILED', updatedAt: { gte: new Date(now - 86400000), lte: new Date(now) } },
      select: { id: true, updatedAt: true }, orderBy: { id: 'asc' }, take: 50,
    });
    await notifyAudioJobFailures([failure]);
    expect(m.createMany.mock.calls[0][0]).toEqual(m.createMany.mock.calls[1][0]);
    expect(m.createMany.mock.calls[0][0].skipDuplicates).toBe(true);
  });

  it('advances a full batch and wraps after the last page', async () => {
    m.findJobs.mockResolvedValueOnce(Array.from({ length: 50 }, (_, i) => ({ id: 'job-' + i, updatedAt: failure.failedAt }))).mockResolvedValueOnce([]);
    expect(await reconcileAudioJobNotifications(null, now)).toBe('job-49');
    expect(await reconcileAudioJobNotifications('job-49', now)).toBeNull();
    expect(m.findJobs.mock.calls[1][0].where.id).toEqual({ gt: 'job-49' });
    expect(m.createMany).toHaveBeenCalledTimes(1);
  });

  it('retains the cursor when delivery or lookup fails and redacts errors', async () => {
    m.findJobs.mockResolvedValueOnce([{ id: 'job-2', updatedAt: failure.failedAt }]).mockRejectedValueOnce(new Error('PRIVATE_PASSWORD'));
    m.createMany.mockRejectedValueOnce(new Error('PRIVATE_PASSWORD'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await reconcileAudioJobNotifications('job-1', now)).toBe('job-1');
      expect(await reconcileAudioJobNotifications('job-1', now)).toBe('job-1');
      expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE_PASSWORD');
    } finally { warn.mockRestore(); }
  });
});
