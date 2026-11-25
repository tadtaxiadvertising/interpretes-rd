import type { Prisma } from '@prisma/client';
import { providerSource } from './provider-source';
import { openProfileCredentials, profileSmtpConfig, validateProfile, vaultKeyAvailable, type ProfileInput } from './provider-vault';
import { emailDeliveryMode } from './pilot-recipient';
import { readOperationalMailConfig } from './operational-config';
import { sendBrevoEmail } from './brevo-transport';
import { sendResendEmail } from './resend-transport';
import { isProviderId } from './provider-catalog';
import { sendReservedSmtpProfile } from './smtp-test';
import { reserveProviderQuota } from './provider-quota';

type Env = Readonly<Record<string, string | undefined>>;
type Reader = Pick<Prisma.TransactionClient, '$queryRaw'>;
type SelectedProfile = ProfileInput & { id: string };
type Message = { recipient: string; subject: string; text: string; html: string };

export function usesProviderVault(env: Env): boolean {
  return providerSource(env) === 'vault';
}

/** Vault operation is initially pilot-only. No fallback to environment secrets. */
export async function readPreferredProvider(db: Reader, env: Env): Promise<SelectedProfile | null> {
  if (!usesProviderVault(env) || env.EMAIL_PROVIDER_VAULT_ENABLED !== 'true'
    || env.OPERATIONAL_EMAIL_ENABLED !== 'true' || !vaultKeyAvailable(env.EMAIL_PROVIDER_ENCRYPTION_KEY)) return null;
  try {
    const rows = await db.$queryRaw<(Omit<ProfileInput, 'apiKey' | 'secretKey'> & { id: string; sealed: string })[]>`
      SELECT p.id::text, p.name, p.provider, p.sender AS "from", p.reply_to AS "replyTo", p.sealed_key AS sealed
      FROM private_email.provider_selection s
      JOIN private_email.provider_profile p ON p.id = s.profile_id
      JOIN private_email.provider_quota q ON q.provider = p.provider
      WHERE s.singleton AND NOT s.dispatch_paused AND p.retired_at IS NULL AND p.test_accepted_at IS NOT NULL AND p.receipt_confirmed_at IS NOT NULL
        AND q.day_start <= (statement_timestamp() AT TIME ZONE 'UTC')::date
        AND q.month_start <= date_trunc('month', statement_timestamp() AT TIME ZONE 'UTC')::date
        AND (CASE WHEN q.day_start = (statement_timestamp() AT TIME ZONE 'UTC')::date THEN q.daily_used ELSE 0 END) < q.daily_limit
        AND (CASE WHEN q.month_start = date_trunc('month', statement_timestamp() AT TIME ZONE 'UTC')::date THEN q.monthly_used ELSE 0 END) < q.monthly_limit
    `;
    if (rows.length !== 1) return null;
    const row = rows[0];
    if (!isProviderId(row.provider)) return null;
    const credentials = openProfileCredentials(row.id, row.provider, row.sealed, env.EMAIL_PROVIDER_ENCRYPTION_KEY);
    const profile = credentials && validateProfile({ ...row, ...credentials });
    return profile ? { ...profile, id: row.id } : null;
  } catch { return null; }
}

/** Only server-side diagnostics may consume this environment projection. */
export async function resolveOperationalMailEnv(db: Reader, env: Env): Promise<Env> {
  if (providerSource(env) === 'invalid') return { ...env, OPERATIONAL_EMAIL_PROVIDER: 'invalid_source' };
  if (!usesProviderVault(env)) return env;
  const profile = await readPreferredProvider(db, env);
  const pilot = emailDeliveryMode(env) === 'pilot';
  if (!profile || (!pilot && env.OPERATIONAL_EMAIL_DISPATCH_ENABLED === 'true')) return { ...env, OPERATIONAL_EMAIL_PROVIDER: 'vault_unavailable' };
  const smtp = profileSmtpConfig(profile);
  if (smtp) return { ...env, OPERATIONAL_EMAIL_PROVIDER: 'smtp',
    OPERATIONAL_SMTP_HOST: smtp.host, OPERATIONAL_SMTP_PORT: '587',
    OPERATIONAL_SMTP_USER: smtp.user, OPERATIONAL_SMTP_PASSWORD: smtp.password,
    OPERATIONAL_EMAIL_FROM: smtp.from, OPERATIONAL_EMAIL_REPLY_TO: smtp.replyTo,
    BREVO_API_KEY: undefined, RESEND_API_KEY: undefined };
  return { ...env, OPERATIONAL_EMAIL_PROVIDER: profile.provider, OPERATIONAL_EMAIL_FROM: profile.from,
    OPERATIONAL_EMAIL_REPLY_TO: profile.replyTo, BREVO_API_KEY: profile.provider === 'brevo' ? profile.apiKey : undefined,
    RESEND_API_KEY: profile.provider === 'resend' ? profile.apiKey : undefined };
}

export async function runtimeMailConfigured(db: Reader, env: Env): Promise<boolean> {
  if (providerSource(env) === 'invalid') return false;
  if (!usesProviderVault(env)) return readOperationalMailConfig(env).status === 'configured';
  return emailDeliveryMode(env) === 'pilot' && !!await readPreferredProvider(db, env);
}

/** Hold the selection row until reservation/claim commit. No network I/O here. */
export async function reserveSelectedProvider(db: Reader, profile: SelectedProfile): Promise<boolean> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT s.profile_id::text AS id FROM private_email.provider_selection s
    JOIN private_email.provider_profile p ON p.id = s.profile_id
    WHERE s.singleton AND NOT s.dispatch_paused AND s.profile_id = ${profile.id}::uuid AND p.retired_at IS NULL FOR SHARE OF s
  `;
  return rows.length === 1 && await reserveProviderQuota(db, profile.provider) === 'reserved';
}

/** Caller must already have committed a reservation. Never retry or fail over. */
export async function sendReservedProfile(profile: SelectedProfile, message: Message): Promise<'accepted' | 'unconfirmed'> {
  const config = { apiKey: profile.apiKey, from: profile.from, replyTo: profile.replyTo || undefined };
  if (profile.provider === 'brevo') return sendBrevoEmail(config, message);
  if (profile.provider === 'resend') return await sendResendEmail(config, message) === 'accepted' ? 'accepted' : 'unconfirmed';
  const smtp = profileSmtpConfig(profile);
  return smtp ? sendReservedSmtpProfile(smtp, message) : 'unconfirmed';
}
