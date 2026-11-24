import type { Prisma } from '@prisma/client';
import { RECRUITMENT_EMAIL_KINDS, type RecruitmentEmailKind } from './recruitment-templates';
import { EMAIL_DELIVERY_STATUSES, type EmailDeliveryStatus, type EmailHistoryReport } from './history-types';

type RawRow = { kind: string; status: string; createdAt: Date; claimedAt: Date | null; completedAt: Date | null };

/** Read-only projection: no recipient, event identifiers, message body or credentials. */
export async function readEmailHistory(db: Pick<Prisma.TransactionClient, '$queryRaw'>): Promise<EmailHistoryReport> {
  try {
    const readiness = await db.$queryRaw<Array<{ installed: boolean }>>`
      SELECT to_regclass('private_email.recruitment_delivery') IS NOT NULL AS installed
    `;
    if (readiness[0]?.installed === false) return { status: 'not_installed' };
    if (readiness[0]?.installed !== true) return { status: 'unavailable' };
    const rows = await db.$queryRaw<RawRow[]>`
      SELECT template_kind AS kind, status, created_at AS "createdAt",
        claimed_at AS "claimedAt", completed_at AS "completedAt"
      FROM private_email.recruitment_delivery
      ORDER BY created_at DESC, event_id DESC LIMIT 30
    `;
    if (rows.some(row => !(RECRUITMENT_EMAIL_KINDS as readonly string[]).includes(row.kind)
      || !(EMAIL_DELIVERY_STATUSES as readonly string[]).includes(row.status))) return { status: 'unavailable' };
    return { status: 'ready', rows: rows.map(row => ({
      kind: row.kind as RecruitmentEmailKind,
      status: row.status as EmailDeliveryStatus,
      createdAt: row.createdAt.toISOString(),
      claimedAt: row.claimedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
    })) };
  } catch {
    return { status: 'unavailable' };
  }
}
