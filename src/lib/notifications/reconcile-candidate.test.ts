// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentActor } from '@/lib/auth/current-actor';
const m = vi.hoisted(() => ({ profile: vi.fn(), application: vi.fn(), publish: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: { userProfile: { findUnique: m.profile }, recruitmentApplication: { findUnique: m.application } } }));
vi.mock('./publish-notification-event', () => ({ publishNotificationEvent: m.publish }));
import { reconcileCandidateNotifications } from './reconcile-candidate';
import { candidateNotificationEvent } from './notify-candidate';

const now = Date.parse('2026-11-25T21:00:00Z');
const actor = (id: number): CurrentActor => ({
  provider: 'supabase', userId: 'account-' + id, role: 'candidate', interpreterId: null, candidateId: id,
  profileId: '123e4567-e89b-42d3-a456-' + String(id).padStart(12, '0'), email: 'candidate@example.test',
});
const application = {
  id: 'app-1', status: 'INTERVIEW_PENDING', version: 3,
  candidate: { email: 'candidate@example.test' },
  events: [{ eventType: 'ROLEPLAY_PASSED', fromStatus: 'ROLEPLAY_REVIEW', toStatus: 'INTERVIEW_PENDING', createdAt: new Date(now - 60000) }],
};

beforeEach(() => {
  vi.resetAllMocks();
  m.profile.mockImplementation(async ({ where }) => ({ id: where.id, role: 'candidate', interpreterId: null, email: 'candidate@example.test' }));
  m.application.mockResolvedValue(application);
  m.publish.mockResolvedValue({ created: true });
});

describe('private candidate reconciliation', () => {
  it('reuses exactly the canonical event for the authenticated candidate', async () => {
    const a = actor(1);
    await reconcileCandidateNotifications(a, now);
    expect(m.profile).toHaveBeenCalledWith({ where: { id: a.profileId }, select: { id: true, email: true, role: true, interpreterId: true } });
    expect(m.application).toHaveBeenCalledWith(expect.objectContaining({ where: { candidateId: 1 } }));
    expect(m.publish).toHaveBeenCalledExactlyOnceWith(candidateNotificationEvent(a.profileId!, { applicationId: 'app-1', status: 'INTERVIEW_PENDING', version: 3 }));
  });

  it('rejects non-candidate actors and missing identities without reading the database', async () => {
    await reconcileCandidateNotifications({ ...actor(2), role: 'interpreter' }, now);
    await reconcileCandidateNotifications({ ...actor(2), profileId: null }, now);
    await reconcileCandidateNotifications({ ...actor(2), candidateId: null }, now);
    expect(m.profile).not.toHaveBeenCalled();
    expect(m.application).not.toHaveBeenCalled();
    expect(m.publish).not.toHaveBeenCalled();
  });

  it('rejects a mismatched profile or application email and an operational profile', async () => {
    m.profile.mockResolvedValueOnce({ id: actor(3).profileId, role: 'candidate', interpreterId: null, email: 'other@example.test' })
      .mockResolvedValueOnce({ id: actor(4).profileId, role: 'candidate', interpreterId: 12, email: actor(4).email });
    await reconcileCandidateNotifications(actor(3), now);
    await reconcileCandidateNotifications(actor(4), now);
    expect(m.application).not.toHaveBeenCalled();
    m.application.mockResolvedValueOnce({ ...application, candidate: { email: 'other@example.test' } });
    await reconcileCandidateNotifications(actor(5), now);
    expect(m.publish).not.toHaveBeenCalled();
  });

  it('ignores missing, old, future, obsolete or unchanged audit events', async () => {
    const event = application.events[0];
    const fixtures = [
      { ...application, events: [] },
      { ...application, events: [{ ...event, createdAt: new Date(now - 86400001) }] },
      { ...application, events: [{ ...event, createdAt: new Date(now + 1) }] },
      { ...application, events: [{ ...event, toStatus: 'ROLEPLAY_REVIEW' }] },
      { ...application, events: [{ ...event, fromStatus: event.toStatus }] },
    ];
    for (let i = 0; i < fixtures.length; i++) {
      m.application.mockResolvedValueOnce(fixtures[i]);
      await reconcileCandidateNotifications(actor(10 + i), now);
    }
    expect(m.publish).not.toHaveBeenCalled();
  });

  it('recovers a new application only from its initial creation audit', async () => {
    const creation = { ...application, status: 'APPLIED', version: 0, events: [{ eventType: 'APPLICATION_CREATED', fromStatus: null, toStatus: 'APPLIED', createdAt: new Date(now - 1000) }] };
    m.application.mockResolvedValueOnce(creation).mockResolvedValueOnce({ ...creation, version: 1 });
    await reconcileCandidateNotifications(actor(20), now);
    await reconcileCandidateNotifications(actor(21), now);
    expect(m.publish).toHaveBeenCalledExactlyOnceWith(candidateNotificationEvent(actor(20).profileId!, { applicationId: 'app-1', status: 'APPLIED', version: 0 }));
  });

  it('limits retry frequency after errors and does not expose provider details', async () => {
    m.publish.mockRejectedValueOnce(new Error('PRIVATE_PASSWORD'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await reconcileCandidateNotifications(actor(30), now);
      await reconcileCandidateNotifications(actor(30), now + 1000);
      expect(m.publish).toHaveBeenCalledTimes(1);
      await reconcileCandidateNotifications(actor(30), now + 300000);
      expect(m.publish).toHaveBeenCalledTimes(2);
      expect(m.publish.mock.calls[0][0]).toEqual(m.publish.mock.calls[1][0]);
      expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE_PASSWORD');
    } finally { warn.mockRestore(); }
  });
});
