import 'server-only';
import prisma from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { notificationEventRow } from './notification-event-row';
import { recruitmentAdminEventRow, type RecruitmentAdminMilestone } from './notify-recruitment';
import { candidateNotificationEvent } from './notify-candidate';
import { qaEvaluationEvent, roleplayEvaluationEvent } from './evaluation-notification-events';
import { roleplayAssignmentEvent } from './communication-notification-events';
import { audioFailureEventRow } from './notify-audio-job-failures';
import { isRecentRecordedPayment, payrollMilestoneEvent } from './payroll-notification-events';
import { ROLEPLAY_PASS_THRESHOLD } from '@/lib/roleplay/scoring';

const LIMIT = 50;
const ADMIN_LIMIT = 20;
const WINDOW_MS = 86_400_000;
type Row = ReturnType<typeof notificationEventRow>;
export const operationalNotificationModules = ['recruitmentAdmin', 'candidate', 'qa', 'roleplayEvaluation', 'roleplayAssignment', 'audio', 'financePayment'] as const;
export type OperationalNotificationModule = typeof operationalNotificationModules[number];
type Module = OperationalNotificationModule;
const MODULES = operationalNotificationModules;
type Reader = Pick<Prisma.TransactionClient, 'userProfile' | 'recruitmentApplication' | 'qAScore' | 'roleplaySession' | 'roleplayAudioJob' | 'payrollRecord' | 'notification'>;

/** Internal shared projection. Never return these rows directly to a client. */
export async function collectOperationalNotificationRows(db: Reader, now: Date) {
  const recent = { gte: new Date(now.getTime() - WINDOW_MS), lte: now };
  const [admins, applications, scores, assignments, jobs, payments] = await Promise.all([
    db.userProfile.findMany({ where: { role: { equals: 'admin', mode: 'insensitive' } }, select: { id: true }, orderBy: { id: 'asc' }, take: ADMIN_LIMIT + 1 }),
    db.recruitmentApplication.findMany({
      where: { OR: [{ status: 'APPLIED', createdAt: recent }, { lastActivityAt: recent }] },
      select: { id: true, status: true, version: true, candidate: { select: { email: true } }, events: {
        select: { eventType: true, fromStatus: true, toStatus: true, createdAt: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1,
      } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: LIMIT + 1,
    }),
    db.qAScore.findMany({
      where: { interpreterId: { not: null }, createdAt: recent, totalScore: { not: null },
        OR: [{ roleplaySession: { is: null } }, { roleplaySession: { is: { recruitmentCandidateId: null, status: 'EVALUATED', evaluatedAt: recent } } }],
      },
      select: { id: true, interpreterId: true, totalScore: true, criticalError: true, accionRequerida: true,
        roleplaySession: { select: { id: true, interpreterId: true, recruitmentCandidateId: true, status: true } },
      },
      orderBy: { id: 'desc' }, take: LIMIT + 1,
    }),
    db.roleplaySession.findMany({
      where: { interpreterId: { not: null }, recruitmentCandidateId: null, status: 'INVITED', updatedAt: recent, scenarios: { some: {}, none: { baseAudioUrl: '' } } },
      select: { id: true, interpreterId: true }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: LIMIT + 1,
    }),
    db.roleplayAudioJob.findMany({
      where: { status: 'FAILED', updatedAt: recent }, select: { id: true, updatedAt: true },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: LIMIT + 1,
    }),
    db.payrollRecord.findMany({
      where: { interpreterId: { not: null }, status: { in: ['Paid', 'PAID'] }, paidAt: recent },
      select: { id: true, interpreterId: true, status: true, paidAt: true },
      orderBy: [{ paidAt: 'desc' }, { id: 'desc' }], take: LIMIT + 1,
    }),
  ]);
  const paymentSample = payments.slice(0, LIMIT).filter(record => isRecentRecordedPayment(record, now));
  const appSample = applications.slice(0, LIMIT);
  const scoreSample = scores.slice(0, LIMIT);
  const assignmentSample = assignments.slice(0, LIMIT);
  const adminSample = admins.slice(0, ADMIN_LIMIT);
  const emails = [...new Set(appSample.map(app => app.candidate.email))];
  const interpreterIds = [...new Set([...scoreSample, ...assignmentSample, ...paymentSample].flatMap(item => item.interpreterId === null ? [] : [item.interpreterId]))];
  const profiles = emails.length || interpreterIds.length ? await db.userProfile.findMany({
    where: { OR: [{ email: { in: emails } }, { interpreterId: { in: interpreterIds } }] },
    select: { id: true, role: true, email: true, interpreterId: true },
  }) : [];
  const candidateByEmail = new Map(profiles.filter(p => p.role?.toLowerCase() === 'candidate' && p.interpreterId === null).map(p => [p.email, p.id]));
  const interpreterById = new Map(profiles.filter(p => p.role?.toLowerCase() === 'interpreter' && p.interpreterId !== null).map(p => [p.interpreterId, p.id]));
  const expected = new Map<Module, Row[]>(MODULES.map(module => [module, []]));
  const add = (module: Module, row: Row) => expected.get(module)!.push(row);

  for (const app of appSample) {
    const event = app.events[0];
    if (!event || event.toStatus !== app.status || event.createdAt < recent.gte || event.createdAt > recent.lte) continue;
    const initial = app.status === 'APPLIED' && app.version === 0 && event.eventType === 'APPLICATION_CREATED' && event.fromStatus === null;
    const transition = app.status !== 'APPLIED' && app.version > 0 && event.fromStatus !== null && event.fromStatus !== event.toStatus;
    if (!initial && !transition) continue;
    let milestone: RecruitmentAdminMilestone | null = null;
    if (initial) milestone = { kind: 'application-created', applicationId: app.id };
    else if (app.status === 'ROLEPLAY_REVIEW') milestone = { kind: 'roleplay-review', applicationId: app.id, version: app.version };
    else if (app.status === 'INTERVIEW_PENDING') milestone = { kind: 'interview-pending', applicationId: app.id, version: app.version };
    if (milestone) for (const admin of adminSample) add('recruitmentAdmin', recruitmentAdminEventRow(admin.id, milestone));
    const recipient = candidateByEmail.get(app.candidate.email);
    if (recipient) {
      const notice = candidateNotificationEvent(recipient, { applicationId: app.id, status: app.status, version: app.version });
      if (notice) add('candidate', notificationEventRow(notice));
    }
  }
  for (const score of scoreSample) {
    const recipient = score.interpreterId === null ? undefined : interpreterById.get(score.interpreterId);
    const totalScore = Number(score.totalScore);
    const actionRequired = score.accionRequerida;
    if (!recipient || score.totalScore === null || !Number.isFinite(totalScore) || totalScore < 0 || totalScore > 100 ||
        (actionRequired !== 'Ninguna' && actionRequired !== 'Feedback Requerido' && actionRequired !== 'Advertencia / Coaching')) continue;
    const session = score.roleplaySession;
    if (session) {
      if (session.recruitmentCandidateId !== null || session.interpreterId !== score.interpreterId || session.status !== 'EVALUATED') continue;
      add('roleplayEvaluation', notificationEventRow(roleplayEvaluationEvent(recipient, {
        sessionId: session.id, totalScore, actionRequired, passed: score.criticalError !== true && totalScore >= ROLEPLAY_PASS_THRESHOLD,
      })));
    } else add('qa', notificationEventRow(qaEvaluationEvent(recipient, { evaluationId: score.id, totalScore, actionRequired })));
  }
  for (const assignment of assignmentSample) {
    const recipient = assignment.interpreterId === null ? undefined : interpreterById.get(assignment.interpreterId);
    if (recipient) add('roleplayAssignment', notificationEventRow(roleplayAssignmentEvent(recipient, assignment.id)));
  }
  for (const payment of paymentSample) {
    const recipient = payment.interpreterId === null ? undefined : interpreterById.get(payment.interpreterId);
    if (recipient && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(recipient)) add('financePayment', notificationEventRow(payrollMilestoneEvent(recipient, payment.id, 'paid')));
  }
  for (const job of jobs.slice(0, LIMIT)) {
    for (const admin of adminSample) add('audio', audioFailureEventRow(admin.id, { id: job.id, failedAt: job.updatedAt }));
  }

  return {
    expected, adminSampled: adminSample.length, adminLimit: ADMIN_LIMIT, sampleLimit: LIMIT,
    truncated: admins.length > ADMIN_LIMIT || [applications, scores, assignments, jobs, payments].some(items => items.length > LIMIT),
  };
}

export async function findStoredOperationalNotices(db: Reader, rows: readonly Row[]) {

  const delivered = new Map<string, { userId: string | null; category: string | null }>();
  for (let offset = 0; offset < rows.length; offset += 200) {
    const stored = await db.notification.findMany({
      where: { id: { in: rows.slice(offset, offset + 200).map(row => row.id) } },
      select: { id: true, userId: true, category: true },
    });
    for (const item of stored) delivered.set(item.id, item);
  }
  return delivered;
}

/** Read-only sample of the same recent eligible events used by repair. */
export async function readOperationalNotificationDiagnostics(now = new Date()) {
  const { expected, ...summary } = await collectOperationalNotificationRows(prisma, now);
  const delivered = await findStoredOperationalNotices(prisma, [...expected.values()].flat());
  const modules = MODULES.map(module => {
    const items = expected.get(module)!;
    return { module, expected: items.length, missing: items.filter(row => {
      const stored = delivered.get(row.id);
      return !stored || stored.userId !== row.userId || stored.category !== row.category;
    }).length };
  });
  return {
    modules, ...summary,
  };
}
