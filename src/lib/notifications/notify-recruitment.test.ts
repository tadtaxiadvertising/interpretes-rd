// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ findMany: vi.fn(), createMany: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: { userProfile: { findMany: m.findMany }, notification: { createMany: m.createMany } } }));
import { notifyRecruitmentAdmins } from './notify-recruitment';

beforeEach(() => {
  vi.resetAllMocks();
  m.findMany.mockResolvedValue([{ id: 'admin-1' }, { id: 'admin-2' }]);
  m.createMany.mockResolvedValue({ count: 2 });
});

describe('recruitment milestone alerts', () => {
  it('targets admin profiles with generic recruitment content', async () => {
    await notifyRecruitmentAdmins({ kind: 'application-created', applicationId: 'private-app-id' });
    expect(m.findMany).toHaveBeenCalledWith({ where: { role: { equals: 'admin', mode: 'insensitive' } }, select: { id: true } });
    expect(m.createMany).toHaveBeenCalledWith({
      data: ['admin-1', 'admin-2'].map(userId => expect.objectContaining({
        userId, category: 'recruitment', type: 'info', title: 'Nueva postulación', link: '/recruitment',
      })),
      skipDuplicates: true,
    });
    expect(JSON.stringify(m.createMany.mock.calls)).not.toContain('private-app-id');
  });

  it('uses the same ID for a repeated milestone and distinct IDs for later transitions', async () => {
    await notifyRecruitmentAdmins({ kind: 'roleplay-review', applicationId: 'app-1', version: 1 });
    await notifyRecruitmentAdmins({ kind: 'roleplay-review', applicationId: 'app-1', version: 1 });
    await notifyRecruitmentAdmins({ kind: 'roleplay-review', applicationId: 'app-1', version: 3 });
    const rows = m.createMany.mock.calls.map(call => call[0].data);
    expect(rows[0]).toEqual(rows[1]);
    expect(rows[0][0].id).not.toBe(rows[2][0].id);
    expect(rows[0][0].id).not.toBe(rows[0][1].id);
  });

  it('isolates delivery failures from committed recruitment operations', async () => {
    m.createMany.mockRejectedValueOnce(new Error('PRIVATE_PASSWORD'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(notifyRecruitmentAdmins({ kind: 'interview-pending', applicationId: 'app-1', version: 2 })).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalled();
      expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE_PASSWORD');
    } finally { warn.mockRestore(); }
  });
});
