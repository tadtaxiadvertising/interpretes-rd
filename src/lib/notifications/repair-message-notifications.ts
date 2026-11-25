import 'server-only';
import prisma from '@/lib/prisma';
import { canAccessChat } from '@/lib/messaging-access';
import { messageReceivedEvent } from './communication-notification-events';
import { notificationEventRow } from './notification-event-row';

const SAMPLE_LIMIT = 200;
const REPAIR_LIMIT = 50;
const WINDOW_MS = 86_400_000;

/** Caller must authorize administrator and explicit confirmation. No client IDs. */
export async function repairMessageNotifications(now = new Date()) {
  return prisma.$transaction(async tx => {
    // Same recent-message sample used by the read-only diagnostic. Recompute
    // eligibility at execution time, not from a potentially stale UI report.
    const messages = await tx.message.findMany({
      orderBy: [{ createdAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
      take: SAMPLE_LIMIT + 1,
      select: { id: true, senderId: true, receiverId: true, createdAt: true, isRead: true },
    });
    const sample = messages.slice(0, SAMPLE_LIMIT);
    const recent = sample.filter(message => {
      const created = message.createdAt?.getTime();
      return message.isRead === false && message.senderId !== message.receiverId &&
        created !== undefined && created >= now.getTime() - WINDOW_MS && created <= now.getTime();
    });
    const ids = [...new Set(recent.flatMap(message => [message.senderId, message.receiverId]))];
    const profiles = ids.length ? await tx.userProfile.findMany({
      where: { id: { in: ids } }, select: { id: true, role: true },
    }) : [];
    const roles = new Map(profiles.map(profile => [profile.id, profile.role]));
    const expected = recent.filter(message => canAccessChat(roles.get(message.receiverId), roles.get(message.senderId)))
      .map(message => notificationEventRow(messageReceivedEvent(message.receiverId, message.id, roles.get(message.receiverId) ?? null)));
    // Check all existing IDs, including wrong-category or wrong-recipient
    // rows. Never overwrite a conflicting row or reset a read receipt.
    const stored = expected.length ? await tx.notification.findMany({
      where: { id: { in: expected.map(row => row.id) } },
      select: { id: true, userId: true, category: true },
    }) : [];
    const byId = new Map(stored.map(row => [row.id, row]));
    const absent = expected.filter(row => !byId.has(row.id));
    const conflicts = expected.filter(row => {
      const existing = byId.get(row.id);
      return existing && (existing.userId !== row.userId || existing.category !== row.category);
    }).length;
    const batch = absent.slice(0, REPAIR_LIMIT);
    const created = batch.length ? (await tx.notification.createMany({ data: batch, skipDuplicates: true })).count : 0;
    return {
      sampled: sample.length, truncated: messages.length > SAMPLE_LIMIT,
      eligible: expected.length, created, conflicts,
      deferred: absent.length - batch.length,
      skipped: batch.length - created,
      repairLimit: REPAIR_LIMIT,
    };
  }, { isolationLevel: 'Serializable' });
}
