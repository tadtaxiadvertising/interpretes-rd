import type { Prisma } from '@prisma/client';
import { providerSource } from './provider-source';
import { canUnpauseVault, readVaultPause } from './vault-pause';

type Db = Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw'>;
export const validProfileId = (id: unknown): id is string =>
  typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export function providerSelectionPaused(env: Readonly<Record<string, string | undefined>>): boolean {
  return providerSource(env) !== 'invalid' && env.EMAIL_PROVIDER_VAULT_ENABLED === 'true'
    && env.OPERATIONAL_EMAIL_ENABLED === 'true'
    && ['OPERATIONAL_EMAIL_DISPATCH_ENABLED', 'OPERATIONAL_EMAIL_BATCH_ENABLED', 'OPERATIONAL_EMAIL_BINDING_ENABLED', 'OPERATIONAL_EMAIL_GENERAL_ENABLED', 'OPERATIONAL_EMAIL_SCHEDULER_ENABLED'].every(flag => env[flag] === 'false');
}

/** First acceptance is retained so later tests cannot invalidate receipt evidence. */
export async function recordProfileAcceptance(db: Db, id: string): Promise<boolean> {
  return await db.$executeRaw`
    UPDATE private_email.provider_profile
    SET test_accepted_at = COALESCE(test_accepted_at, statement_timestamp())
    WHERE id = ${id}::uuid AND retired_at IS NULL
  ` === 1;
}

/** Explicit operator attestation, not provider delivery telemetry. */
export async function confirmProfileReceipt(db: Db, id: string, actor: string): Promise<boolean> {
  return await db.$executeRaw`
    UPDATE private_email.provider_profile
    SET receipt_confirmed_at = COALESCE(receipt_confirmed_at, statement_timestamp()),
        receipt_confirmed_by = COALESCE(receipt_confirmed_by, ${actor})
    WHERE id = ${id}::uuid AND retired_at IS NULL AND test_accepted_at IS NOT NULL
  ` === 1;
}

/** Single row serializes selection. Eligibility and remaining local budget
 * are evaluated in the database, never trusted from a client request. */
export async function selectPreferredProfile(db: Db, id: string, actor: string): Promise<boolean> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    UPDATE private_email.provider_selection s
    SET profile_id = p.id, changed_at = statement_timestamp(), changed_by = ${actor}
    FROM private_email.provider_profile p
    JOIN private_email.provider_quota q ON q.provider = p.provider
    WHERE s.singleton AND p.id = ${id}::uuid
      AND p.retired_at IS NULL AND p.test_accepted_at IS NOT NULL AND p.receipt_confirmed_at IS NOT NULL
      AND q.day_start <= (statement_timestamp() AT TIME ZONE 'UTC')::date
      AND q.month_start <= date_trunc('month', statement_timestamp() AT TIME ZONE 'UTC')::date
      AND (CASE WHEN q.day_start = (statement_timestamp() AT TIME ZONE 'UTC')::date THEN q.daily_used ELSE 0 END) < q.daily_limit
      AND (CASE WHEN q.month_start = date_trunc('month', statement_timestamp() AT TIME ZONE 'UTC')::date THEN q.monthly_used ELSE 0 END) < q.monthly_limit
    RETURNING s.profile_id::text AS id
  `;
  return rows.length === 1;
}

export async function clearPreferredProfile(db: Db, actor: string): Promise<boolean> {
  return await db.$executeRaw`
    UPDATE private_email.provider_selection
    SET profile_id = NULL, changed_at = statement_timestamp(), changed_by = ${actor}
    WHERE singleton
  ` === 1;
}

type Env = Readonly<Record<string, string | undefined>>;

/** Only preference switching can use the database pause. Other maintenance
 * operations still require the deployment-level controls to be disabled. */
export async function canEditProviderPreference(db: Db, env: Env): Promise<boolean> {
  if (providerSource(env) !== 'vault') return providerSelectionPaused(env);
  return (providerSelectionPaused(env) || canUnpauseVault(env)) && await readVaultPause(db) === 'paused';
}

/** Caller must execute within a transaction. Use the same row lock as resume
 * and reservations so a stale UI cannot switch a running transport. */
export async function changeProviderPreference(db: Db, id: string | null, actor: string, env: Env): Promise<'saved' | 'cleared' | 'disabled' | 'blocked'> {
  if ((id !== null && !validProfileId(id)) || !actor || actor.length > 255) return 'blocked';
  if (providerSource(env) === 'vault') {
    if (!providerSelectionPaused(env) && !canUnpauseVault(env)) return 'disabled';
    const rows = await db.$queryRaw<{ paused: boolean }[]>`
      SELECT dispatch_paused AS paused FROM private_email.provider_selection WHERE singleton FOR UPDATE
    `;
    if (rows.length !== 1 || rows[0].paused !== true) return 'disabled';
  } else {
    if (!providerSelectionPaused(env)) return 'disabled';
    const rows = await db.$queryRaw<{ singleton: boolean }[]>`
      SELECT singleton FROM private_email.provider_selection WHERE singleton FOR UPDATE
    `;
    if (rows.length !== 1) return 'blocked';
  }
  if (id === null) return await clearPreferredProfile(db, actor) ? 'cleared' : 'blocked';
  return await selectPreferredProfile(db, id, actor) ? 'saved' : 'blocked';
}
