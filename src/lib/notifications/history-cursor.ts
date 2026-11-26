import 'server-only';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { notificationCategories, type NotificationCategory } from './notification-display';

export const HistoryCursorSchema = z.object({
  id: z.string().min(1).max(128),
  createdAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/).refine(value => Number.isFinite(Date.parse(value))).nullable(),
}).strict();

export type HistoryCursor = z.infer<typeof HistoryCursorSchema>;
type HistoryRow = {
  id: string; title: string; message: string; type: string | null;
  isRead: boolean | null; createdAt: Date | null; link: string | null; category: string | null;
  cursorTime: string | null;
};
type Reader = Pick<Prisma.TransactionClient, '$queryRaw'>;

export async function readHistoryCursorPage(db: Reader, recipientIds: readonly string[], candidateOnly: boolean, filters: {
  unreadOnly: boolean; category?: NotificationCategory; importantOnly?: boolean; after: HistoryCursor | null;
}) {
  if (!recipientIds.length || (candidateOnly && filters.category && filters.category !== 'recruitment')) {
    return { rows: [] as Omit<HistoryRow, 'cursorTime'>[], nextCursor: null };
  }

  const recipients = Prisma.join(recipientIds.map(id => Prisma.sql`${id}::uuid`));
  const conditions = [Prisma.sql`n.user_id IN (${recipients})`];
  if (candidateOnly) conditions.push(Prisma.sql`n.category = 'recruitment' AND n.link = '/candidate'`);
  if (filters.unreadOnly) conditions.push(Prisma.sql`(n.is_read = false OR n.is_read IS NULL)`);
  if (filters.category === 'system') {
    conditions.push(Prisma.sql`(n.category = 'system' OR n.category IS NULL OR n.category NOT IN (${Prisma.join([...notificationCategories])}))`);
  } else if (filters.category) conditions.push(Prisma.sql`n.category = ${filters.category}`);
  if (filters.importantOnly) conditions.push(Prisma.sql`n.type IN ('warning', 'error')`);
  const after = filters.after;
  if (after) {
    conditions.push(after.createdAt === null
      ? Prisma.sql`(n.created_at IS NULL AND n.id < ${after.id})`
      : Prisma.sql`(n.created_at < ${after.createdAt}::timestamptz OR n.created_at IS NULL OR
          (n.created_at = ${after.createdAt}::timestamptz AND n.id < ${after.id}))`);
  }

  // Keep microseconds in the cursor. JavaScript Date truncates them and can
  // otherwise skip notices created within the same millisecond.
  const records = await db.$queryRaw<HistoryRow[]>(Prisma.sql`
    SELECT n.id, n.title, n.message, n.type, n.is_read AS "isRead",
      n.created_at AS "createdAt", n.link, n.category,
      to_char(n.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorTime"
    FROM public.notifications n
    WHERE ${Prisma.join(conditions, ' AND ')}
    ORDER BY n.created_at DESC NULLS LAST, n.id DESC
    LIMIT 21
  `);
  const page = records.slice(0, 20);
  const last = page.at(-1);
  const nextCursor = records.length > 20 && last ? { id: last.id, createdAt: last.cursorTime } : null;
  return { rows: page.map(({ cursorTime: _cursorTime, ...row }) => row), nextCursor };
}
