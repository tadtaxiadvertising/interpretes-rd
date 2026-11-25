// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ application: vi.fn(), profile: vi.fn(), publish: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: { recruitmentApplication: { findUnique: m.application }, userProfile: { findUnique: m.profile } } }));
vi.mock('./publish-notification-event', () => ({ publishNotificationEvent: m.publish }));
import { notifyCandidateMilestone } from './notify-candidate';

const input = { applicationId: 'app-1', status: 'INTERVIEW_PENDING' as const, version: 3 };
const profile = { id: '123e4567-e89b-42d3-a456-426614174000', role: 'candidate', interpreterId: null };

beforeEach(() => {
  vi.resetAllMocks();
  m.application.mockResolvedValue({ status: input.status, version: input.version, candidate: { email: 'candidate@example.test' } });
  m.profile.mockResolvedValue(profile);
  m.publish.mockResolvedValue({ created: true });
});

describe('candidate milestone delivery', () => {
  it('uses the persisted application and restricted profile, with a safe private portal destination', async () => {
    await notifyCandidateMilestone(input);
    expect(m.profile).toHaveBeenCalledWith({ where: { email: 'candidate@example.test' }, select: { id: true, role: true, interpreterId: true } });
    expect(m.publish).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      userId: profile.id, eventKey: 'recruitment.candidate:app-1:3:INTERVIEW_PENDING',
      category: 'recruitment', link: '/candidate', title: 'Etapa de entrevista',
    }));
    expect(JSON.stringify(m.publish.mock.calls)).not.toContain('candidate@example.test');
  });

  it('skips obsolete transitions and statuses without candidate-facing notices', async () => {
    m.application.mockResolvedValueOnce({ status: input.status, version: 4 });
    await notifyCandidateMilestone(input);
    await notifyCandidateMilestone({ ...input, status: 'HIRING' });
    expect(m.application).toHaveBeenCalledTimes(1);
    expect(m.profile).not.toHaveBeenCalled();
    expect(m.publish).not.toHaveBeenCalled();
  });

  it.each([null, { ...profile, role: 'admin' }, { ...profile, role: 'interpreter' }, { ...profile, interpreterId: 8 }, { ...profile, id: 'not-a-uuid' }])('skips profiles that cannot safely receive candidate alerts', async (recipient) => {
    m.profile.mockResolvedValueOnce(recipient);
    await notifyCandidateMilestone(input);
    expect(m.publish).not.toHaveBeenCalled();
  });

  it('isolates failures and redacts provider errors', async () => {
    m.publish.mockRejectedValueOnce(new Error('PRIVATE_PASSWORD'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(notifyCandidateMilestone(input)).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalled();
      expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE_PASSWORD');
    } finally { warn.mockRestore(); }
  });
});
