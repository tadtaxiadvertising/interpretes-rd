'use server';

import { randomUUID } from 'node:crypto';
import { validateAction } from '@/lib/auth/actions';
import prisma from '@/lib/prisma';
import { openProfileKey, sealProfileKey, validateProfile, vaultKeyAvailable, type ProfileMetadata } from '@/lib/email/provider-vault';
import { sendBrevoEmailDetailed } from '@/lib/email/brevo-transport';
import { sendResendEmail } from '@/lib/email/resend-transport';

type Status = 'ready' | 'disabled' | 'key_missing' | 'unauthorized' | 'unavailable';
type ListResult = { status: Status; profiles: ProfileMetadata[] };
type ProfileRow = Omit<ProfileMetadata, 'updatedAt'> & { updatedAt: Date };
const key = () => process.env.EMAIL_PROVIDER_ENCRYPTION_KEY;
function availability(): Status {
  if (process.env.EMAIL_PROVIDER_VAULT_ENABLED !== 'true') return 'disabled';
  return vaultKeyAvailable(key()) ? 'ready' : 'key_missing';
}

export async function listEmailProviderProfiles(): Promise<ListResult> {
  try {
    const auth = await validateAction('admin');
    if ('error' in auth) return { status: 'unauthorized', profiles: [] };
    const status = availability();
    if (status !== 'ready') return { status, profiles: [] };
    const rows = await prisma.$queryRaw<ProfileRow[]>`
      SELECT id::text, name, provider, sender AS "from", reply_to AS "replyTo", updated_at AS "updatedAt"
      FROM private_email.provider_profile ORDER BY updated_at DESC LIMIT 50
    `;
    return { status: 'ready', profiles: rows.map(row => ({ ...row, updatedAt: row.updatedAt.toISOString() })) };
  } catch {
    return { status: 'unavailable', profiles: [] };
  }
}

export async function addEmailProviderProfile(input: unknown): Promise<'saved' | 'invalid' | 'unauthorized' | 'disabled' | 'key_missing' | 'unavailable'> {
  try {
    const auth = await validateAction('admin');
    if ('error' in auth) return 'unauthorized';
    const status = availability();
    if (status !== 'ready') return status;
    const profile = validateProfile(input);
    if (!profile) return 'invalid';
    const id = randomUUID();
    const sealed = sealProfileKey(id, profile.provider, profile.apiKey, key());
    await prisma.$executeRaw`
      INSERT INTO private_email.provider_profile (id, name, provider, sender, reply_to, sealed_key, updated_by)
      VALUES (${id}::uuid, ${profile.name}, ${profile.provider}, ${profile.from}, ${profile.replyTo}, ${sealed}, ${auth.user.userId})
    `;
    return 'saved';
  } catch {
    return 'unavailable';
  }
}

let nextTestAt = 0;
let testing = false;

/** Explicit test to the saved sender only. No activation, ledger changes or retry. */
export async function testSavedEmailProvider(id: string) {
  try {
    const auth = await validateAction('admin');
    if ('error' in auth) return 'unauthorized' as const;
    if (availability() !== 'ready' || process.env.OPERATIONAL_EMAIL_ENABLED !== 'true'
      || ['OPERATIONAL_EMAIL_DISPATCH_ENABLED', 'OPERATIONAL_EMAIL_BATCH_ENABLED', 'OPERATIONAL_EMAIL_BINDING_ENABLED', 'OPERATIONAL_EMAIL_GENERAL_ENABLED', 'OPERATIONAL_EMAIL_SCHEDULER_ENABLED'].some(flag => process.env[flag] !== 'false')) return 'disabled' as const;
    if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return 'invalid' as const;
    if (testing || Date.now() < nextTestAt) return 'rate_limited' as const;
    testing = true;
    nextTestAt = Date.now() + 60000;
    try {
      const [row] = await prisma.$queryRaw<(ProfileRow & { sealed: string })[]>`
        SELECT id::text, name, provider, sender AS "from", reply_to AS "replyTo", updated_at AS "updatedAt", sealed_key AS sealed
        FROM private_email.provider_profile WHERE id = ${id}::uuid
      `;
      if (!row || (row.provider !== 'brevo' && row.provider !== 'resend')) return 'invalid' as const;
      const apiKey = openProfileKey(row.id, row.provider, row.sealed, key());
      const profile = validateProfile({ ...row, apiKey });
      if (!profile) return 'invalid' as const;
      const message = { recipient: profile.from, subject: 'Prueba de perfil | Intérpretes RD', text: 'Prueba de configuración. No contiene datos de postulantes.', html: '<p>Prueba de configuración. No contiene datos de postulantes.</p>' };
      const config = { apiKey: profile.apiKey, from: profile.from, replyTo: profile.replyTo || undefined };
      return profile.provider === 'brevo' ? await sendBrevoEmailDetailed(config, message) : await sendResendEmail(config, message);
    } finally {
      testing = false;
    }
  } catch {
    return 'unavailable' as const;
  }
}
