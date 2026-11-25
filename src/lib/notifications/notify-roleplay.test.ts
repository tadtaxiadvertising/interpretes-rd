// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ findMany: vi.fn(), findUnique: vi.fn(), publish: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: { userProfile: { findMany: m.findMany, findUnique: m.findUnique } } }));
vi.mock('./publish-notification-event', () => ({ publishNotificationEvent: m.publish }));

import { notifyRoleplayAssignments, notifyRoleplayEvaluation } from './notify-roleplay';

const profile = { id: '123e4567-e89b-42d3-a456-426614174000', interpreterId: 7, role: 'interpreter' };
const evaluation = { sessionId: 'session-1', interpreterId: 7, recruitmentCandidateId: null, totalScore: 84, actionRequired: 'Feedback', passed: true };

beforeEach(() => {
  vi.resetAllMocks();
  m.findUnique.mockResolvedValue(profile);
  m.findMany.mockResolvedValue([profile]);
  m.publish.mockResolvedValue({ created: true });
});

describe('roleplay notifications', () => {
  it('sends evaluation results only to the linked interpreter and uses a stable event key', async () => {
    await notifyRoleplayEvaluation(evaluation);
    expect(m.findUnique).toHaveBeenCalledWith({ where: { interpreterId: 7 }, select: { id: true, role: true } });
    expect(m.publish).toHaveBeenCalledWith(expect.objectContaining({
      userId: profile.id, eventKey: 'roleplay.evaluated:session-1',
      category: 'roleplay', type: 'success', link: '/dashboard/roleplays',
      message: expect.stringContaining('84.0%'),
    }));
  });

  it('never sends candidate-owned results to a legacy interpreter association', async () => {
    await notifyRoleplayEvaluation({ ...evaluation, recruitmentCandidateId: 9 });
    expect(m.findUnique).not.toHaveBeenCalled();
    expect(m.publish).not.toHaveBeenCalled();
  });

  it('does not notify missing or non-interpreter profiles', async () => {
    m.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...profile, role: 'admin' });
    await notifyRoleplayEvaluation(evaluation);
    await notifyRoleplayEvaluation(evaluation);
    expect(m.publish).not.toHaveBeenCalled();
  });

  it('notifies only linked interpreter recipients in the committed assignment batch', async () => {
    m.findMany.mockResolvedValue([profile, { id: 'admin-profile', interpreterId: 8, role: 'admin' }]);
    await notifyRoleplayAssignments([{ id: 's7', interpreterId: 7 }, { id: 's8', interpreterId: 8 }, { id: 's9', interpreterId: 9 }]);
    expect(m.findMany).toHaveBeenCalledTimes(1);
    expect(m.publish).toHaveBeenCalledTimes(1);
    expect(m.publish).toHaveBeenCalledWith(expect.objectContaining({ userId: profile.id, eventKey: 'roleplay.assigned:s7', link: '/dashboard/roleplays' }));
  });

  it('isolates failed deliveries without exposing private details', async () => {
    m.publish.mockRejectedValue(new Error('PRIVATE_PASSWORD'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(notifyRoleplayEvaluation(evaluation)).resolves.toBeUndefined();
      await expect(notifyRoleplayAssignments([{ id: 's7', interpreterId: 7 }])).resolves.toBeUndefined();
      expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE_PASSWORD');
    } finally { warn.mockRestore(); }
  });
});
