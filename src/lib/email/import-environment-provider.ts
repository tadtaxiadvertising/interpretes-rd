import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { readOperationalMailConfig } from './operational-config';
import { validateProfile, sealProfileCredentials, vaultKeyAvailable, type ProfileInput } from './provider-vault';
import { providerSelectionPaused } from './provider-selection';

type Env = Readonly<Record<string, string | undefined>>;
type Db = Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw'>;
export function existingEnvironmentProfile(env: Env): ProfileInput | null {
  if (env.EMAIL_PROVIDER_SOURCE && env.EMAIL_PROVIDER_SOURCE !== 'environment') return null;
  if (!providerSelectionPaused(env) || !vaultKeyAvailable(env.EMAIL_PROVIDER_ENCRYPTION_KEY)) return null;
  const result = readOperationalMailConfig(env);
  if (result.status !== 'configured' || result.provider === 'smtp') return null;
  return validateProfile({ name: result.provider === 'brevo' ? 'Brevo (configuración existente)' : 'Resend (configuración existente)', provider: result.provider, from: result.config.from, replyTo: result.config.replyTo ?? '', apiKey: result.config.apiKey });
}

/** Admin-only caller, inside a transaction. Never selects or sends the profile.
 * A repeated import does not replace credentials or reset verification. */
export async function importEnvironmentProvider(db: Db, env: Env, actor: string): Promise<'imported' | 'already_saved' | 'blocked'> {
  const profile = existingEnvironmentProfile(env);
  if (!profile || !actor || actor.length > 255) return 'blocked';
  const selection = await db.$queryRaw<{ singleton: boolean }[]>`
    SELECT singleton FROM private_email.provider_selection WHERE singleton AND dispatch_paused FOR UPDATE
  `;
  if (selection.length !== 1) return 'blocked';
  const duplicates = await db.$queryRaw<{ present: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM private_email.provider_profile WHERE provider=${profile.provider} AND lower(sender)=lower(${profile.from}) AND retired_at IS NULL) AS present
  `;
  if (duplicates.length !== 1) return 'blocked';
  if (duplicates[0].present) return 'already_saved';
  const id = randomUUID();
  const sealed = sealProfileCredentials(id, profile, env.EMAIL_PROVIDER_ENCRYPTION_KEY);
  const rows = await db.$executeRaw`
    INSERT INTO private_email.provider_profile(id,name,provider,sender,reply_to,sealed_key,updated_by)
    SELECT ${id}::uuid,${profile.name},${profile.provider},${profile.from},${profile.replyTo},${sealed},${actor}
    WHERE EXISTS (SELECT 1 FROM private_email.provider_quota WHERE provider=${profile.provider})
  `;
  return rows === 1 ? 'imported' : 'blocked';
}
