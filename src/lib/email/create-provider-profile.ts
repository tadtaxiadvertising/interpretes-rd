import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { validateProfile, sealProfileCredentials, vaultKeyAvailable } from './provider-vault';

type Db = Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw'>;

/** Caller must use a transaction. The selection lock serializes manual creation
 * with environment imports and profile lifecycle mutations. */
export async function createProviderProfile(db: Db, input: unknown, actor: string, envKey: string | undefined): Promise<'saved' | 'already_saved' | 'invalid' | 'unavailable'> {
  const profile = validateProfile(input);
  if (!profile || !actor || actor.length > 255 || !vaultKeyAvailable(envKey)) return 'invalid';
  const selection = await db.$queryRaw<{ singleton: boolean }[]>`
    SELECT singleton FROM private_email.provider_selection WHERE singleton FOR UPDATE
  `;
  if (selection.length !== 1) return 'unavailable';
  const duplicates = await db.$queryRaw<{ present: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM private_email.provider_profile
      WHERE provider=${profile.provider} AND lower(sender)=lower(${profile.from}) AND retired_at IS NULL) AS present
  `;
  if (duplicates.length !== 1) return 'unavailable';
  if (duplicates[0].present) return 'already_saved';
  const id = randomUUID();
  const sealed = sealProfileCredentials(id, profile, envKey);
  const inserted = await db.$executeRaw`
    INSERT INTO private_email.provider_profile (id, name, provider, sender, reply_to, sealed_key, updated_by)
    SELECT ${id}::uuid, ${profile.name}, ${profile.provider}, ${profile.from}, ${profile.replyTo}, ${sealed}, ${actor}
    WHERE EXISTS (SELECT 1 FROM private_email.provider_quota WHERE provider=${profile.provider})
  `;
  return inserted === 1 ? 'saved' : 'unavailable';
}
