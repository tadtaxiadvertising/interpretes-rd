import type { Prisma } from '@prisma/client';

import type { ProviderId as Provider } from './provider-catalog';
type QuotaDb = Pick<Prisma.TransactionClient, '$queryRaw'>;
export type ProviderQuota = { provider: Provider; dailyLimit: number; monthlyLimit: number; dailyUsed: number; monthlyUsed: number };

/** Reserve one attempt before network I/O. Row-level UPDATE serializes concurrent
 * attempts, including across replicas and profiles of the same provider. Never
 * refund ambiguous failures: the provider may have accepted the message. */
export async function reserveProviderQuota(db: QuotaDb, provider: Provider): Promise<'reserved' | 'quota_reached'> {
  const rows = await db.$queryRaw<{ provider: string }[]>`
    WITH clock AS (
      SELECT (statement_timestamp() AT TIME ZONE 'UTC')::date AS day,
        date_trunc('month', statement_timestamp() AT TIME ZONE 'UTC')::date AS month
    )
    UPDATE private_email.provider_quota q
    SET day_start = clock.day, month_start = clock.month,
      daily_used = CASE WHEN q.day_start = clock.day THEN q.daily_used + 1 ELSE 1 END,
      monthly_used = CASE WHEN q.month_start = clock.month THEN q.monthly_used + 1 ELSE 1 END
    FROM clock
    WHERE q.provider = ${provider}
      AND q.day_start <= clock.day AND q.month_start <= clock.month
      AND (CASE WHEN q.day_start = clock.day THEN q.daily_used ELSE 0 END) < q.daily_limit
      AND (CASE WHEN q.month_start = clock.month THEN q.monthly_used ELSE 0 END) < q.monthly_limit
    RETURNING q.provider
  `;
  return rows.length === 1 ? 'reserved' : 'quota_reached';
}

/** Effective counters, without changing the database or retrieving credentials. */
export async function listProviderQuotas(db: QuotaDb): Promise<ProviderQuota[]> {
  return db.$queryRaw<ProviderQuota[]>`
    SELECT provider, daily_limit AS "dailyLimit", monthly_limit AS "monthlyLimit",
      CASE WHEN day_start < (statement_timestamp() AT TIME ZONE 'UTC')::date THEN 0 ELSE daily_used END AS "dailyUsed",
      CASE WHEN month_start < date_trunc('month', statement_timestamp() AT TIME ZONE 'UTC')::date THEN 0 ELSE monthly_used END AS "monthlyUsed"
    FROM private_email.provider_quota ORDER BY provider
  `;
}
