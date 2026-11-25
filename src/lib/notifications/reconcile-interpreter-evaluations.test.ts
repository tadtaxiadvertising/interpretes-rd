// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentActor } from '@/lib/auth/current-actor';
const m = vi.hoisted(() => ({ profile: vi.fn(), scores: vi.fn(), insert: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: { userProfile: { findUnique: m.profile }, qAScore: { findMany: m.scores }, notification: { createMany: m.insert } } }));
import { reconcileInterpreterEvaluations } from './reconcile-interpreter-evaluations';
import { qaEvaluationEvent, roleplayEvaluationEvent } from './evaluation-notification-events';
import { notificationEventRow } from './notification-event-row';

const now = Date.parse('2026-11-25T21:00:00Z');
const actor = (id: number): CurrentActor => ({
  provider: 'supabase', userId: 'account-' + id, role: 'interpreter', interpreterId: 7, candidateId: null,
  profileId: '123e4567-e89b-42d3-a456-' + String(id).padStart(12, '0'), email: 'worker@example.test',
});
const qa = { id: 11, totalScore: 90, criticalError: false, accionRequerida: 'Ninguna', roleplaySession: null };
const session = { id: 'sess-1', interpreterId: 7, recruitmentCandidateId: null, status: 'EVALUATED' };
const roleplay = { ...qa, id: 12, totalScore: 65, accionRequerida: 'Advertencia / Coaching', roleplaySession: session };

beforeEach(() => {
  vi.resetAllMocks();
  m.profile.mockImplementation(async ({ where }) => ({ id: where.id, role: 'interpreter', interpreterId: 7, email: 'worker@example.test' }));
  m.scores.mockResolvedValue([]);
  m.insert.mockResolvedValue({ count: 2 });
});

describe('interpreter evaluation recovery', () => {
  it('uses original event keys and sends each score through its correct module', async () => {
    const a = actor(1);
    m.scores.mockResolvedValueOnce([qa, roleplay]);
    await reconcileInterpreterEvaluations(a, now);
    expect(m.scores).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      where: {
        interpreterId: 7, createdAt: { gte: new Date(now - 86400000), lte: new Date(now) },
        totalScore: { not: null },
        OR: [{ roleplaySession: { is: null } }, { roleplaySession: { is: {
          interpreterId: 7, recruitmentCandidateId: null, status: 'EVALUATED',
          evaluatedAt: { gte: new Date(now - 86400000), lte: new Date(now) },
        } } }],
      }, orderBy: { id: 'asc' }, take: 50,
    }));
    expect(m.insert).toHaveBeenCalledExactlyOnceWith({ data: [
      notificationEventRow(qaEvaluationEvent(a.profileId!, { evaluationId: 11, totalScore: 90, actionRequired: 'Ninguna' })),
      notificationEventRow(roleplayEvaluationEvent(a.profileId!, { sessionId: 'sess-1', totalScore: 65, actionRequired: 'Advertencia / Coaching', passed: false })),
    ], skipDuplicates: true });
  });

  it('never reads evaluations for an invalid or differently linked actor', async () => {
    await reconcileInterpreterEvaluations({ ...actor(2), role: 'candidate' }, now);
    await reconcileInterpreterEvaluations({ ...actor(2), profileId: null }, now);
    await reconcileInterpreterEvaluations({ ...actor(2), interpreterId: null }, now);
    expect(m.profile).not.toHaveBeenCalled();
    m.profile.mockResolvedValueOnce({ id: actor(3).profileId, role: 'interpreter', interpreterId: 8, email: actor(3).email })
      .mockResolvedValueOnce({ id: actor(4).profileId, role: 'interpreter', interpreterId: 7, email: 'other@example.test' });
    await reconcileInterpreterEvaluations(actor(3), now);
    await reconcileInterpreterEvaluations(actor(4), now);
    expect(m.scores).not.toHaveBeenCalled();
    expect(m.insert).not.toHaveBeenCalled();
  });

  it('excludes candidate sessions, mismatched ownership, non-evaluated and invalid scores or free text', async () => {
    m.scores.mockResolvedValueOnce([
      { ...roleplay, roleplaySession: { ...session, recruitmentCandidateId: 9 } },
      { ...roleplay, roleplaySession: { ...session, interpreterId: 8 } },
      { ...roleplay, roleplaySession: { ...session, status: 'UNDER_REVIEW' } },
      { ...qa, totalScore: null }, { ...qa, totalScore: 101 }, { ...qa, totalScore: NaN },
      { ...qa, accionRequerida: 'private note' },
    ]);
    await reconcileInterpreterEvaluations(actor(5), now);
    expect(m.insert).not.toHaveBeenCalled();
  });

  it('limits retries, advances the cursor after success, and wraps at the end', async () => {
    m.scores.mockResolvedValueOnce(Array.from({ length: 50 }, (_, i) => ({ ...qa, id: i + 1 })));
    await reconcileInterpreterEvaluations(actor(6), now);
    await reconcileInterpreterEvaluations(actor(6), now + 1000);
    expect(m.scores).toHaveBeenCalledTimes(1);
    await reconcileInterpreterEvaluations(actor(6), now + 300000);
    expect(m.scores.mock.calls[1][0].where.id).toEqual({ gt: 50 });
    await reconcileInterpreterEvaluations(actor(6), now + 600000);
    expect(m.scores.mock.calls[2][0].where.id).toBeUndefined();
  });

  it('retains cursor after insert failure and redacts errors', async () => {
    m.scores.mockResolvedValueOnce(Array.from({ length: 50 }, (_, i) => ({ ...qa, id: i + 1 })));
    m.insert.mockRejectedValueOnce(new Error('PRIVATE_PASSWORD'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await reconcileInterpreterEvaluations(actor(7), now);
      await reconcileInterpreterEvaluations(actor(7), now + 1000);
      await reconcileInterpreterEvaluations(actor(7), now + 300000);
      expect(m.scores).toHaveBeenCalledTimes(2);
      expect(m.scores.mock.calls[1][0].where.id).toBeUndefined();
      expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE_PASSWORD');
    } finally { warn.mockRestore(); }
  });
});
