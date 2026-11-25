import 'server-only';
import prisma from '@/lib/prisma';
import type { CurrentActor } from '@/lib/auth/current-actor';
import { authorizedNotificationRecipientIds } from './authorized-recipient-ids';
import { notificationEventRow } from './notification-event-row';
import { messageReceivedEvent, roleplayAssignmentEvent } from './communication-notification-events';
import { canAccessChat } from '@/lib/messaging-access';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';

const INTERVAL_MS = 300_000;
const WINDOW_MS = 86_400_000;
const PAGE_SIZE = 50;
const MAX_SCOPES = 256;
type Scan = { attemptedAt: number; inFlight: boolean; assignmentCursor: string | null; messageCursor: string | null };
const scans = new Map<string, Scan>();

/** Recover only notices which still correspond to actionable records. */
export async function reconcileCommunications(actor: CurrentActor, nowMs = Date.now()): Promise<void> {
  if ((actor.role !== 'admin' && actor.role !== 'interpreter') ||
      !actor.profileId || !actor.email || !authorizedNotificationRecipientIds(null, actor.profileId).length) return;
  const key = actor.profileId.toLowerCase() + ':' + actor.role + ':' + actor.interpreterId;
  let scan = scans.get(key);
  if (scan && (scan.inFlight || nowMs - scan.attemptedAt < INTERVAL_MS)) return;
  if (!scan) {
    if (scans.size >= MAX_SCOPES) {
      const evictable = [...scans].find(([, value]) => !value.inFlight);
      if (!evictable) return;
      scans.delete(evictable[0]);
    }
    scan = { attemptedAt: nowMs, inFlight: false, assignmentCursor: null, messageCursor: null };
  }
  scan.attemptedAt = nowMs;
  scan.inFlight = true;
  scans.delete(key);
  scans.set(key, scan);

  try {
    const profile = await prisma.userProfile.findUnique({
      where: { id: actor.profileId },
      select: { id: true, role: true, email: true, interpreterId: true },
    });
    if (!profile || profile.role?.toLowerCase() !== actor.role ||
        profile.email.trim().toLowerCase() !== actor.email.trim().toLowerCase()) return;
    const recent = { gte: new Date(nowMs - WINDOW_MS), lte: new Date(nowMs) };

    if (actor.role === 'interpreter' && actor.interpreterId !== null &&
        Number.isSafeInteger(actor.interpreterId) && actor.interpreterId > 0 &&
        profile.interpreterId === actor.interpreterId) {
      try {
        const sessions = await prisma.roleplaySession.findMany({
          where: {
            interpreterId: actor.interpreterId, recruitmentCandidateId: null,
            status: 'INVITED', updatedAt: recent,
            scenarios: { some: {}, none: { baseAudioUrl: '' } },
            ...(scan.assignmentCursor ? { id: { gt: scan.assignmentCursor } } : {}),
          },
          select: { id: true },
          orderBy: { id: 'asc' }, take: PAGE_SIZE,
        });
        if (sessions.length) await prisma.notification.createMany({
          data: sessions.map(session => notificationEventRow(roleplayAssignmentEvent(profile.id, session.id))),
          skipDuplicates: true,
        });
        scan.assignmentCursor = sessions.length === PAGE_SIZE ? sessions[sessions.length - 1].id : null;
      } catch (error) {
        console.warn('Assignment notification reconciliation failed:', safeServerErrorCategory(error));
      }
    }

    // All chat operations now address the verified linked profile UUID.
    try {
      const messages = await prisma.message.findMany({
        where: {
          receiverId: profile.id, senderId: { not: profile.id }, isRead: false, createdAt: recent,
          ...(scan.messageCursor ? { id: { gt: scan.messageCursor } } : {}),
        },
        select: { id: true, senderId: true },
        orderBy: { id: 'asc' }, take: PAGE_SIZE,
      });
      if (messages.length) {
        const senders = await prisma.userProfile.findMany({
          where: { id: { in: [...new Set(messages.map(message => message.senderId))] } },
          select: { id: true, role: true },
        });
        const roles = new Map(senders.map(sender => [sender.id, sender.role]));
        const rows = messages.filter(message => message.senderId !== profile.id &&
          canAccessChat(actor.role, roles.get(message.senderId))).map(message =>
          notificationEventRow(messageReceivedEvent(profile.id, message.id, actor.role)));
        if (rows.length) await prisma.notification.createMany({ data: rows, skipDuplicates: true });
      }
      scan.messageCursor = messages.length === PAGE_SIZE ? messages[messages.length - 1].id : null;
    } catch (error) {
      console.warn('Message notification reconciliation failed:', safeServerErrorCategory(error));
    }
  } catch (error) {
    console.warn('Communication notification reconciliation failed:', safeServerErrorCategory(error));
  } finally {
    scan.inFlight = false;
  }
}
