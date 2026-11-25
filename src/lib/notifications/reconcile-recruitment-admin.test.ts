// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ profile: vi.fn(), applications: vi.fn(), insert: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: { userProfile: { findUnique: m.profile }, recruitmentApplication: { findMany: m.applications }, notification: { createMany: m.insert } } }));
import { reconcileRecruitmentAdminNotifications } from './reconcile-recruitment-admin';
import { recruitmentAdminEventRow } from './notify-recruitment';

const now = Date.parse('2026-11-25T21:00:00Z');
const recent = new Date(now - 60000);
const uid = (n: number) => '123e4567-e89b-42d3-a456-' + String(n).padStart(12, '0');
const application = (id: string, status = 'INTERVIEW_PENDING', version = 3) => ({
  id, status, version, events: [{ eventType: 'ROLEPLAY_PASSED', fromStatus: 'ROLEPLAY_REVIEW', toStatus: status, createdAt: recent }],
});

beforeEach(() => {
  vi.resetAllMocks();
  m.profile.mockImplementation(async ({ where }) => ({ id: where.id, role: 'admin' }));
  m.applications.mockResolvedValue([]);
  m.insert.mockResolvedValue({ count: 1 });
});

describe('recruitment notification recovery', () => {
  it('recreates exactly the canonical event ID for the current admin and preserves existing reads', async () => {
    m.applications.mockResolvedValueOnce([application('app-1')]);
    await reconcileRecruitmentAdminNotifications(uid(1), now);
    expect(m.profile).toHaveBeenCalledWith({ where: { id: uid(1) }, select: { id: true, role: true } });
    expect(m.insert).toHaveBeenCalledExactlyOnceWith({
      data: [recruitmentAdminEventRow(uid(1), { kind: 'interview-pending', applicationId: 'app-1', version: 3 })],
      skipDuplicates: true,
    });
    expect(m.applications.mock.calls[0][0]).toMatchObject({
      where: { OR: [
        { status: 'APPLIED', createdAt: { gte: new Date(now - 86400000), lte: new Date(now) } },
        { status: { in: ['ROLEPLAY_REVIEW', 'INTERVIEW_PENDING'] }, lastActivityAt: { gte: new Date(now - 86400000), lte: new Date(now) } },
      ] },
      orderBy: { id: 'asc' }, take: 50,
    });
  });

  it('ignores obsolete, unaudited, unchanged and old stages', async () => {
    const base = application('base');
    m.applications.mockResolvedValueOnce([
      { ...base, id: 'missing', events: [] },
      { ...base, id: 'wrong', events: [{ ...base.events[0], toStatus: 'ROLEPLAY_REVIEW' }] },
      { ...base, id: 'unchanged', events: [{ ...base.events[0], fromStatus: base.status }] },
      { ...base, id: 'old', events: [{ ...base.events[0], createdAt: new Date(now - 86400001) }] },
      { ...base, id: 'future', events: [{ ...base.events[0], createdAt: new Date(now + 1) }] },
      { ...base, id: 'new', status: 'APPLIED', version: 0, events: [{ eventType: 'APPLICATION_CREATED', fromStatus: null, toStatus: 'APPLIED', createdAt: recent }] },
    ]);
    await reconcileRecruitmentAdminNotifications(uid(2), now);
    expect(m.insert).toHaveBeenCalledExactlyOnceWith({
      data: [recruitmentAdminEventRow(uid(2), { kind: 'application-created', applicationId: 'new' })],
      skipDuplicates: true,
    });
  });

  it('does not scan for a non-admin profile or invalid identity', async () => {
    m.profile.mockResolvedValueOnce({ id: uid(3), role: 'candidate' });
    await reconcileRecruitmentAdminNotifications(uid(3), now);
    await reconcileRecruitmentAdminNotifications('invalid', now);
    expect(m.profile).toHaveBeenCalledTimes(1);
    expect(m.applications).not.toHaveBeenCalled();
    expect(m.insert).not.toHaveBeenCalled();
  });

  it('throttles attempts per profile, advances bounded pages and wraps after the last page', async () => {
    m.applications.mockResolvedValueOnce(Array.from({ length: 50 }, (_, i) => application('app-' + i))).mockResolvedValueOnce([]);
    await reconcileRecruitmentAdminNotifications(uid(4), now);
    await reconcileRecruitmentAdminNotifications(uid(4), now + 1000);
    expect(m.applications).toHaveBeenCalledTimes(1);
    await reconcileRecruitmentAdminNotifications(uid(4), now + 300000);
    expect(m.applications.mock.calls[1][0].where.id).toEqual({ gt: 'app-49' });
    await reconcileRecruitmentAdminNotifications(uid(4), now + 600000);
    expect(m.applications.mock.calls[2][0].where.id).toBeUndefined();
  });

  it('retains the page after insert failure and redacts database details', async () => {
    m.applications.mockResolvedValueOnce(Array.from({ length: 50 }, (_, i) => application('app-' + i)));
    m.insert.mockRejectedValueOnce(new Error('PRIVATE_PASSWORD'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await reconcileRecruitmentAdminNotifications(uid(5), now);
      await reconcileRecruitmentAdminNotifications(uid(5), now + 1000);
      await reconcileRecruitmentAdminNotifications(uid(5), now + 300000);
      expect(m.applications).toHaveBeenCalledTimes(2);
      expect(m.applications.mock.calls[1][0].where.id).toBeUndefined();
      expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE_PASSWORD');
    } finally { warn.mockRestore(); }
  });
});
