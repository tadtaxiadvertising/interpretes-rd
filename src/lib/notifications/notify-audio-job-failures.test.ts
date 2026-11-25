// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ findMany: vi.fn(), createMany: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: { userProfile: { findMany: m.findMany }, notification: { createMany: m.createMany } } }));
import { notifyAudioJobFailures } from './notify-audio-job-failures';

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
      await expect(notifyAudioJobFailures([failure])).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalled();
      expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE_PASSWORD');
    } finally { warn.mockRestore(); }
  });
});
