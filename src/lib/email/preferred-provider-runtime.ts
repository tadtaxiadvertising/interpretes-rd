import type { Prisma } from '@prisma/client';
import { openProfileKey, validateProfile, vaultKeyAvailable, type ProfileInput } from './provider-vault';
import { emailDeliveryMode } from './pilot-recipient';
import { readOperationalMailConfig } from './operational-config';
import { sendBrevoEmail } from './brevo-transport';
import { sendResendEmail } from './resend-transport';
import { reserveProviderQuota } from './provider-quota';

type Env = Readonly<Record<string, string | undefined>>;
type Reader = Pick<Prisma.TransactionClient, '$queryRaw'>;
type SelectedProfile = ProfileInput & { id: string };
type Message = { recipient: string; subject: string; text: string; html: string };

export function usesProviderVault(env: Env): boolean {
  return env.EMAIL_PROVIDER_SOURCE === 'vault';
}

/** Vault operation is initially pilot-only. No fallback to environment secrets. */
export async function readPreferredProvider(db: Reader, env: Env): Promise<SelectedProfile | null> {
  if (!usesProviderVault(env) || env.EMAIL_PROVIDER_VAULT_ENABLED !== 'true'
    || env.OPERATIONAL_EMAIL_ENABLED !== 'true' || !vaultKeyAvailable(env.EMAIL_PROVIDER_ENCRYPTION_KEY)) return null;
  try {
    const rows = await db.$queryRaw<(Omit<ProfileInput, 'apiKey'> & { id: string; sealed: string })[]>`
      SELECT p.id::text, p.name, p.provider, p.sender AS "from", p.reply_to AS "replyTo", p.sealed_key AS sealed
      FROM private_email.provider_selection s
      JOIN private_email.provider_profile p ON p.id = s.profile_id
      JOIN private_email.provider_quota q ON q.provider = p.provider
      WHERE s.singleton AND p.test_accepted_at IS NOT NULL AND p.receipt_confirmed_at IS NOT NULL
        AND q.day_start <= (statement_timestamp() AT TIME ZONE 'UTC')::date
        AND q.month_start <= date_trunc('month', statement_timestamp() AT TIME ZONE 'UTC')::date
        AND (CASE WHEN q.day_start = (statement_timestamp() AT TIME ZONE 'UTC')::date THEN q.daily_used ELSE 0 END) < q.daily_limit
        AND (CASE WHEN q.month_start = date_trunc('month', statement_timestamp() AT TIME ZONE 'UTC')::date THEN q.monthly_used ELSE 0 END) < q.monthly_limit
    `;
    if (rows.length !== 1) return null;
    const row = rows[0];
    if (row.provider !== 'brevo' && row.provider !== 'resend') return null;
    const apiKey = openProfileKey(row.id, row.provider, row.sealed, env.EMAIL_PROVIDER_ENCRYPTION_KEY);
    const profile = validateProfile({ ...row, apiKey });
    return profile ? { ...profile, id: row.id } : null;
  } catch { return null; }
}

/** Only server-side diagnostics may consume this environment projection. */
export async function resolveOperationalMailEnv(db: Reader, env: Env): Promise<Env> {
  if (!usesProviderVault(env)) return env;
  const profile = await readPreferredProvider(db, env);
  const pilot = emailDeliveryMode(env) === 'pilot';
  if (!profile || (!pilot && env.OPERATIONAL_EMAIL_DISPATCH_ENABLED === 'true')) return { ...env, OPERATIONAL_EMAIL_PROVIDER: 'vault_unavailable' };
  return { ...env, OPERATIONAL_EMAIL_PROVIDER: profile.provider, OPERATIONAL_EMAIL_FROM: profile.from,
    OPERATIONAL_EMAIL_REPLY_TO: profile.replyTo, BREVO_API_KEY: profile.provider === 'brevo' ? profile.apiKey : undefined,
    RESEND_API_KEY: profile.provider === 'resend' ? profile.apiKey : undefined };
}

export async function runtimeMailConfigured(db: Reader, env: Env): Promise<boolean> {
  if (!usesProviderVault(env)) return readOperationalMailConfig(env).status === 'configured';
  return emailDeliveryMode(env) === 'pilot' && !!await readPreferredProvider(db, env);
}

/** Hold the selection row until reservation/claim commit. No network I/O here. */
export async function reserveSelectedProvider(db: Reader, profile: SelectedProfile): Promise<boolean> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT profile_id::text AS id FROM private_email.provider_selection
    WHERE singleton AND profile_id = ${profile.id}::uuid FOR SHARE
  `;
  return rows.length === 1 && await reserveProviderQuota(db, profile.provider) === 'reserved';
}

/** Caller must already have committed a reservation. Never retry or fail over. */
export async function sendReservedProfile(profile: SelectedProfile, message: Message): Promise<'accepted' | 'unconfirmed'> {
  const config = { apiKey: profile.apiKey, from: profile.from, replyTo: profile.replyTo || undefined };
  return profile.provider === 'brevo' ? sendBrevoEmail(config, message)
    : await sendResendEmail(config, message) === 'accepted' ? 'accepted' : 'unconfirmed';
}
