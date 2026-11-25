import type { Prisma } from '@prisma/client';
import { emailDeliveryMode } from './pilot-recipient';
import { vaultKeyAvailable } from './provider-vault';

type Db = Pick<Prisma.TransactionClient, '$queryRaw'>;
type Env = Readonly<Record<string, string | undefined>>;
export type VaultPauseState = 'paused' | 'unpaused' | 'unavailable';

export async function readVaultPause(db: Db): Promise<VaultPauseState> {
  try {
    const rows = await db.$queryRaw<{ paused: boolean }[]>`
      SELECT dispatch_paused AS paused FROM private_email.provider_selection WHERE singleton
    `;
    return rows.length === 1 ? rows[0].paused === true ? 'paused' : rows[0].paused === false ? 'unpaused' : 'unavailable' : 'unavailable';
  } catch { return 'unavailable'; }
}

/** Unpausing does not modify environment gates, start a job or send mail. */
export function canUnpauseVault(env: Env): boolean {
  return env.EMAIL_PROVIDER_SOURCE === 'vault' && env.EMAIL_PROVIDER_VAULT_ENABLED === 'true'
    && env.OPERATIONAL_EMAIL_ENABLED === 'true' && vaultKeyAvailable(env.EMAIL_PROVIDER_ENCRYPTION_KEY)
    && emailDeliveryMode(env) === 'pilot' && env.OPERATIONAL_EMAIL_SCHEDULER_ENABLED === 'false';
}

/** The selection row is also locked during operational quota reservation.
 * A completed pause blocks new reservations; earlier committed ones may finish. */
export async function setVaultPause(db: Db, paused: boolean, actor: string): Promise<boolean> {
  if (typeof paused !== 'boolean' || !actor || actor.length > 255) return false;
  const rows = await db.$queryRaw<{ paused: boolean }[]>`
    UPDATE private_email.provider_selection s
    SET dispatch_paused = ${paused}, pause_changed_at = statement_timestamp(), pause_changed_by = ${actor}
    WHERE s.singleton AND (${paused} OR EXISTS (
      SELECT 1 FROM private_email.provider_profile p
      JOIN private_email.provider_quota q ON q.provider=p.provider
      WHERE p.id=s.profile_id AND p.retired_at IS NULL
        AND p.test_accepted_at IS NOT NULL AND p.receipt_confirmed_at IS NOT NULL
        AND q.day_start <= (statement_timestamp() AT TIME ZONE 'UTC')::date
        AND q.month_start <= date_trunc('month', statement_timestamp() AT TIME ZONE 'UTC')::date
        AND (CASE WHEN q.day_start=(statement_timestamp() AT TIME ZONE 'UTC')::date THEN q.daily_used ELSE 0 END) < q.daily_limit
        AND (CASE WHEN q.month_start=date_trunc('month', statement_timestamp() AT TIME ZONE 'UTC')::date THEN q.monthly_used ELSE 0 END) < q.monthly_limit
    ))
    RETURNING s.dispatch_paused AS paused
  `;
  return rows.length === 1 && rows[0].paused === paused;
}
