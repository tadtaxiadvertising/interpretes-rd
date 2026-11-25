import 'server-only';
import prisma from '@/lib/prisma';
import { collectOperationalNotificationRows, findStoredOperationalNotices, type OperationalNotificationModule } from './operational-notification-diagnostics';

const REPAIR_LIMIT = 50;

/** Only an authorized administrator action may invoke this writer. */
export async function repairOperationalNotifications(module: OperationalNotificationModule, now = new Date()) {
  return prisma.$transaction(async tx => {
    const { expected, truncated } = await collectOperationalNotificationRows(tx, now);
    const rows = expected.get(module);
    if (!rows) throw new Error('Invalid operational module');
    const stored = await findStoredOperationalNotices(tx, rows);
    const absent = rows.filter(row => !stored.has(row.id));
    const conflicts = rows.filter(row => {
      const existing = stored.get(row.id);
      return existing && (existing.userId !== row.userId || existing.category !== row.category);
    }).length;
    const batch = absent.slice(0, REPAIR_LIMIT);
    const created = batch.length ? (await tx.notification.createMany({ data: batch, skipDuplicates: true })).count : 0;
    return {
      module, eligible: rows.length, truncated, created, conflicts,
      deferred: absent.length - batch.length, skipped: batch.length - created,
      repairLimit: REPAIR_LIMIT,
    };
  }, { isolationLevel: 'Serializable' });
}
