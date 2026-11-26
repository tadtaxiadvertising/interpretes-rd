// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ profiles: vi.fn(), applications: vi.fn(), scores: vi.fn(), assignments: vi.fn(), jobs: vi.fn(), payments: vi.fn(), notices: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: {
  userProfile: { findMany: m.profiles }, recruitmentApplication: { findMany: m.applications },
  qAScore: { findMany: m.scores }, roleplaySession: { findMany: m.assignments },
  roleplayAudioJob: { findMany: m.jobs }, payrollRecord: { findMany: m.payments }, notification: { findMany: m.notices },
} }));
import { readOperationalNotificationDiagnostics } from './operational-notification-diagnostics';
import { audioFailureEventRow } from './notify-audio-job-failures';
import { recruitmentAdminEventRow } from './notify-recruitment';
import { notificationEventRow } from './notification-event-row';
import { qaEvaluationEvent } from './evaluation-notification-events';

const now = new Date('2026-11-25T21:00:00Z');
const admin = { id: '123e4567-e89b-42d3-a456-426614174000' };
const interpreter = { id: '123e4567-e89b-42d3-a456-426614174001', email: 'private-worker@example.test', role: 'interpreter', interpreterId: 7 };
const candidate = { id: '123e4567-e89b-42d3-a456-426614174002', email: 'private-candidate@example.test', role: 'candidate', interpreterId: null };
const application = { id: 'app-1', status: 'APPLIED', version: 0, candidate: { email: candidate.email }, events: [{ eventType: 'APPLICATION_CREATED', fromStatus: null, toStatus: 'APPLIED', createdAt: now }] };
const score = { id: 1, interpreterId: 7, totalScore: 90, criticalError: false, accionRequerida: 'Ninguna', roleplaySession: null };
const job = { id: 'job-1', updatedAt: now };

beforeEach(() => {
  vi.resetAllMocks();
  for (const mock of Object.values(m)) mock.mockResolvedValue([]);
});

describe('operational notification diagnostics', () => {
  it('checks canonical expected IDs and counts missing recipient-category pairs separately', async () => {
    m.profiles.mockResolvedValueOnce([admin]).mockResolvedValueOnce([interpreter, candidate]);
    m.applications.mockResolvedValueOnce([application]);
    m.scores.mockResolvedValueOnce([score, { ...score, id: 2, roleplaySession: { id: 'session-1', interpreterId: 7, recruitmentCandidateId: null, status: 'EVALUATED' } }]);
    m.assignments.mockResolvedValueOnce([{ id: 'assignment-1', interpreterId: 7 }]);
    m.jobs.mockResolvedValueOnce([job]);
    m.notices.mockResolvedValueOnce([
      recruitmentAdminEventRow(admin.id, { kind: 'application-created', applicationId: 'app-1' }),
      notificationEventRow(qaEvaluationEvent(interpreter.id, { evaluationId: 1, totalScore: 90, actionRequired: 'Ninguna' })),
      { ...audioFailureEventRow(admin.id, { id: job.id, failedAt: now }), category: 'system' },
    ]);
    const report = await readOperationalNotificationDiagnostics(now);
    expect(report.modules).toEqual([
      { module: 'recruitmentAdmin', expected: 1, missing: 0 },
      { module: 'candidate', expected: 1, missing: 1 },
      { module: 'qa', expected: 1, missing: 0 },
      { module: 'roleplayEvaluation', expected: 1, missing: 1 },
      { module: 'roleplayAssignment', expected: 1, missing: 1 },
      { module: 'audio', expected: 1, missing: 1 },
      { module: 'financePayment', expected: 0, missing: 0 },
    ]);
    expect(JSON.stringify(report)).not.toContain('private-');
    expect(JSON.stringify(report)).not.toContain(admin.id);
    expect(m.notices.mock.calls[0][0].select).toEqual({ id: true, userId: true, category: true });
  });

  it('excludes old audits, missing ownership, candidate sessions and invalid action labels', async () => {
    m.profiles.mockResolvedValueOnce([admin]).mockResolvedValueOnce([interpreter, candidate]);
    m.applications.mockResolvedValueOnce([{ ...application, events: [{ ...application.events[0], createdAt: new Date(now.getTime() - 86400001) }] }]);
    m.scores.mockResolvedValueOnce([
      { ...score, totalScore: null },
      { ...score, accionRequerida: 'private text' },
      { ...score, interpreterId: 8 },
      { ...score, roleplaySession: { id: 'session-2', interpreterId: 7, recruitmentCandidateId: 3, status: 'EVALUATED' } },
    ]);
    m.assignments.mockResolvedValueOnce([{ id: 'assignment-2', interpreterId: 8 }]);
    const report = await readOperationalNotificationDiagnostics(now);
    expect(report.modules.every(item => item.expected === 0 && item.missing === 0)).toBe(true);
    expect(m.notices).not.toHaveBeenCalled();
  });

  it('caps source and admin samples and batches expected IDs', async () => {
    m.profiles.mockResolvedValueOnce(Array.from({ length: 21 }, (_, i) => ({ id: 'admin-' + i })));
    m.jobs.mockResolvedValueOnce(Array.from({ length: 51 }, (_, i) => ({ id: 'job-' + i, updatedAt: now })));
    const report = await readOperationalNotificationDiagnostics(now);
    expect(report).toMatchObject({ sampleLimit: 50, adminLimit: 20, adminSampled: 20, truncated: true });
    expect(report.modules.find(item => item.module === 'audio')).toEqual({ module: 'audio', expected: 1000, missing: 1000 });
    expect(m.jobs.mock.calls[0][0].take).toBe(51);
    expect(m.profiles.mock.calls[0][0].take).toBe(21);
    expect(m.notices).toHaveBeenCalledTimes(5);
    expect(m.notices.mock.calls.every(([query]) => query.where.id.in.length === 200)).toBe(true);
  });

  it('reports empty samples without looking up recipients or notification IDs', async () => {
    const report = await readOperationalNotificationDiagnostics(now);
    expect(report.modules.every(item => item.expected === 0)).toBe(true);
    expect(report.truncated).toBe(false);
    expect(m.profiles).toHaveBeenCalledTimes(1);
    expect(m.notices).not.toHaveBeenCalled();
  });
  it('counts only recent recorded payments with a linked interpreter, without exposing financial identifiers', async () => {
    m.profiles.mockResolvedValueOnce([]).mockResolvedValueOnce([interpreter]);
    m.payments.mockResolvedValueOnce([
      { id: 'private-payment', interpreterId: 7, status: 'PAID', paidAt: now },
      { id: 'private-old', interpreterId: 7, status: 'Paid', paidAt: new Date(now.getTime() - 86400001) },
      { id: 'private-unpaid', interpreterId: 7, status: 'APPROVED', paidAt: now },
      { id: 'private-other', interpreterId: 8, status: 'PAID', paidAt: now },
    ]);
    const report = await readOperationalNotificationDiagnostics(now);
    expect(report.modules.find(item => item.module === 'financePayment')).toEqual({ module: 'financePayment', expected: 1, missing: 1 });
    expect(m.payments).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ where: { interpreterId: { not: null }, status: { in: ['Paid', 'PAID'] }, paidAt: { gte: new Date(now.getTime() - 86400000), lte: now } }, take: 51 }));
    expect(JSON.stringify(report)).not.toContain('private-');
  });
});
