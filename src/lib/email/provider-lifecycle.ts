import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { validateProfile, sealProfileCredentials, type ProfileInput } from './provider-vault';
import { validProfileId } from './provider-selection';

type Db = Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw'>;
export type ReplacementInput = { id: string; profile: ProfileInput };

export function validateReplacement(input: unknown): ReplacementInput | null {
  if (!input || typeof input !== 'object') return null;
  const { id, profile } = input as Record<string, unknown>;
  const validated = validateProfile(profile);
  return validProfileId(id) && validated ? { id, profile: validated } : null;
}

/** Caller must use one transaction. Lock selection first (same ordering as
 * quota reservation). Retire the original; never reset budget or delete history. */
export async function retireProviderProfile(db: Db, id: string, actor: string): Promise<boolean> {
  if (!validProfileId(id) || !actor || actor.length > 255) return false;
  const selection = await db.$queryRaw<{ singleton: boolean }[]>`
    SELECT singleton FROM private_email.provider_selection WHERE singleton FOR UPDATE
  `;
  if (selection.length !== 1) throw new Error('Selection unavailable');
  const changed = await db.$executeRaw`
    UPDATE private_email.provider_profile SET retired_at = statement_timestamp(), retired_by = ${actor}
    WHERE id = ${id}::uuid AND retired_at IS NULL
  `;
  if (changed !== 1) return false;
  await db.$executeRaw`
    UPDATE private_email.provider_selection SET profile_id = NULL, changed_at = statement_timestamp(), changed_by = ${actor}
    WHERE singleton AND profile_id = ${id}::uuid
  `;
  return true;
}

/** A replacement gets a new ID and fresh proof requirements. Old credentials
 * cannot be selected again; no verification evidence is inherited. */
export async function replaceProviderProfile(db: Db, input: ReplacementInput, actor: string, envKey: string | undefined): Promise<boolean | 'already_saved'> {
  const validated = validateReplacement(input);
  if (!validated || !actor || actor.length > 255) return false;
  const { id, profile } = validated;
  // Use the same transaction lock as creation/import before checking conflicts.
  const selection = await db.$queryRaw<{ singleton: boolean }[]>`
    SELECT singleton FROM private_email.provider_selection WHERE singleton FOR UPDATE
  `;
  if (selection.length !== 1) throw new Error('Selection unavailable');
  const rows = await db.$queryRaw<{ provider: string }[]>`
    SELECT provider FROM private_email.provider_profile WHERE id = ${id}::uuid AND retired_at IS NULL
  `;
  if (rows.length !== 1) return false;
  if (rows[0].provider !== profile.provider) throw new Error('Provider type cannot change');
  const duplicates = await db.$queryRaw<{ present: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM private_email.provider_profile
      WHERE provider=${profile.provider} AND lower(sender)=lower(${profile.from})
        AND retired_at IS NULL AND id <> ${id}::uuid) AS present
  `;
  if (duplicates.length !== 1) throw new Error('Duplicate check unavailable');
  if (duplicates[0].present) return 'already_saved';
  const newId = randomUUID();
  const sealed = sealProfileCredentials(newId, profile, envKey);
  // The transaction already holds the selection lock; reacquiring it is safe.
  if (!await retireProviderProfile(db, id, actor)) return false;
  const inserted = await db.$executeRaw`
    INSERT INTO private_email.provider_profile (id, name, provider, sender, reply_to, sealed_key, updated_by, replaces_id)
    VALUES (${newId}::uuid, ${profile.name}, ${profile.provider}, ${profile.from}, ${profile.replyTo}, ${sealed}, ${actor}, ${id}::uuid)
  `;
  if (inserted !== 1) throw new Error('Replacement not saved');
  return true;
}
