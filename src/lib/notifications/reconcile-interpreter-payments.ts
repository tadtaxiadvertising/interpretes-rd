import 'server-only';
import prisma from '@/lib/prisma';
import type { CurrentActor } from '@/lib/auth/current-actor';
import { authorizedNotificationRecipientIds } from './authorized-recipient-ids';
import { notificationEventRow } from './notification-event-row';
import { isRecentRecordedPayment, PAYMENT_NOTICE_WINDOW_MS, payrollMilestoneEvent } from './payroll-notification-events';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';

const INTERVAL_MS = 300_000;
const PAGE_SIZE = 50;
const MAX_SCOPES = 256;
type Scan = { attemptedAt: number; inFlight: boolean; cursor: string | null };
const scans = new Map<string, Scan>();

/** Internal-only: recover only the authenticated interpreter's recent recorded payments. */
export async function reconcileInterpreterPayments(actor: CurrentActor, nowMs = Date.now()): Promise<void> {
  if (actor.role !== 'interpreter' || !actor.interpreterId || !Number.isSafeInteger(actor.interpreterId) ||
      actor.interpreterId <= 0 || !actor.profileId || !actor.email ||
      !authorizedNotificationRecipientIds(null, actor.profileId).length) return;
  const key = actor.profileId.toLowerCase() + ':' + actor.interpreterId;
  let scan = scans.get(key);
  if (scan && (scan.inFlight || nowMs - scan.attemptedAt < INTERVAL_MS)) return;
  if (!scan) {
    if (scans.size >= MAX_SCOPES) {
      const evictable = [...scans].find(([, value]) => !value.inFlight);
      if (!evictable) return;
      scans.delete(evictable[0]);
    }
    scan = { attemptedAt: nowMs, inFlight: false, cursor: null };
  }
  scan.attemptedAt = nowMs;
  scan.inFlight = true;
  scans.delete(key);
  scans.set(key, scan);

  try {
    const profile = await prisma.userProfile.findUnique({
      where: { id: actor.profileId },
      select: { id: true, role: true, interpreterId: true, email: true },
    });
    if (profile?.role?.toLowerCase() !== 'interpreter' ||
        profile.interpreterId !== actor.interpreterId ||
        profile.email.trim().toLowerCase() !== actor.email.trim().toLowerCase()) return;

    const recent = { gte: new Date(nowMs - WINDOW_MS), lte: new Date(nowMs) };
    const records = await prisma.payrollRecord.findMany({
      where: {
        interpreterId: actor.interpreterId,
        ...(scan.cursor !== null ? { id: { gt: scan.cursor } } : {}),
        status: { in: ['Paid', 'PAID'] },
        paidAt: recent,
      },
      select: { id: true, interpreterId: true, status: true, paidAt: true },
      orderBy: { id: 'asc' },
      take: PAGE_SIZE,
    });
    const rows = records.filter(record => record.interpreterId === actor.interpreterId && isRecentRecordedPayment(record, recent.lte))
      .map(record => notificationEventRow(payrollMilestoneEvent(profile.id, record.id, 'paid')));
    if (rows.length) await prisma.notification.createMany({ data: rows, skipDuplicates: true });
    scan.cursor = records.length === PAGE_SIZE ? records[records.length - 1].id : null;
  } catch (error) {
    console.warn('Interpreter payment notification reconciliation failed:', safeServerErrorCategory(error));
  } finally {
    scan.inFlight = false;
  }
}
