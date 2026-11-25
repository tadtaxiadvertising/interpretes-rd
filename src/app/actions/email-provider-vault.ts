'use server';

import { randomUUID } from 'node:crypto';
import { existingEnvironmentProfile, importEnvironmentProvider } from '@/lib/email/import-environment-provider';
import { validateAction } from '@/lib/auth/actions';
import prisma from '@/lib/prisma';
import { openProfileCredentials, sealProfileCredentials, profileSmtpConfig, validateProfile, vaultKeyAvailable, type ProfileMetadata } from '@/lib/email/provider-vault';
import { sendBrevoEmailDetailed } from '@/lib/email/brevo-transport';
import { isProviderId } from '@/lib/email/provider-catalog';
import { sendReservedSmtpProfile } from '@/lib/email/smtp-test';
import { sendResendEmail } from '@/lib/email/resend-transport';

import { validateBudget, validateBudgetRevision, updateProviderBudget } from '@/lib/email/provider-budget';
import { reserveProviderQuota, listProviderQuotas, type ProviderQuota } from '@/lib/email/provider-quota';

import { providerSelectionPaused, validProfileId, recordProfileAcceptance, confirmProfileReceipt, canEditProviderPreference, changeProviderPreference } from '@/lib/email/provider-selection';

import { retireProviderProfile, replaceProviderProfile, validateReplacement } from '@/lib/email/provider-lifecycle';

type ListedProfile = ProfileMetadata & { testAcceptedAt: string | null; receiptConfirmedAt: string | null; retiredAt: string | null };
type Status = 'ready' | 'disabled' | 'key_missing' | 'unauthorized' | 'unavailable';
type ListResult = { status: Status; profiles: ListedProfile[]; quotas?: ProviderQuota[]; preferredId?: string | null; selectionPaused?: boolean; preferenceEditable?: boolean; environmentImport?: { provider: 'brevo' | 'resend'; from: string } };
type ProfileRow = Omit<ProfileMetadata, 'updatedAt'> & { updatedAt: Date; testAcceptedAt: Date | null; receiptConfirmedAt: Date | null; retiredAt: Date | null };
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
      SELECT id::text, name, provider, sender AS "from", reply_to AS "replyTo", updated_at AS "updatedAt",
        test_accepted_at AS "testAcceptedAt", receipt_confirmed_at AS "receiptConfirmedAt", retired_at AS "retiredAt"
      FROM private_email.provider_profile ORDER BY (retired_at IS NOT NULL), updated_at DESC LIMIT 50
    `;
    const quotas = await listProviderQuotas(prisma);
    if (!quotas.some(q => q.provider === 'brevo') || !quotas.some(q => q.provider === 'resend')) return { status: 'unavailable', profiles: [] };
    const [selection] = await prisma.$queryRaw<{ id: string | null }[]>`
      SELECT profile_id::text AS id FROM private_email.provider_selection WHERE singleton
    `;
    if (!selection) return { status: 'unavailable', profiles: [] };
    const existing = existingEnvironmentProfile(process.env);
    const environmentImport = existing && (existing.provider === 'brevo' || existing.provider === 'resend') && !rows.some(row => row.retiredAt === null && row.provider === existing.provider && row.from.toLowerCase() === existing.from.toLowerCase()) ? { provider: existing.provider, from: existing.from } : undefined;
    return { status: 'ready', environmentImport, profiles: rows.map(row => ({ ...row, updatedAt: row.updatedAt.toISOString(),
      testAcceptedAt: row.testAcceptedAt?.toISOString() ?? null, receiptConfirmedAt: row.receiptConfirmedAt?.toISOString() ?? null, retiredAt: row.retiredAt?.toISOString() ?? null })),
      quotas, preferredId: selection.id, selectionPaused: providerSelectionPaused(process.env), preferenceEditable: await canEditProviderPreference(prisma, process.env) };
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
    const sealed = sealProfileCredentials(id, profile, key());
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
    if (availability() !== 'ready' || !providerSelectionPaused(process.env)) return 'disabled' as const;
    if (!validProfileId(id)) return 'invalid' as const;
    if (testing || Date.now() < nextTestAt) return 'rate_limited' as const;
    testing = true;
    nextTestAt = Date.now() + 60000;
    try {
      const [row] = await prisma.$queryRaw<(ProfileRow & { sealed: string })[]>`
        SELECT id::text, name, provider, sender AS "from", reply_to AS "replyTo", updated_at AS "updatedAt", sealed_key AS sealed
        FROM private_email.provider_profile WHERE id = ${id}::uuid AND retired_at IS NULL
      `;
      if (!row || !isProviderId(row.provider)) return 'invalid' as const;
      const credentials = openProfileCredentials(row.id, row.provider, row.sealed, key());
      const profile = credentials && validateProfile({ ...row, ...credentials });
      if (!profile) return 'invalid' as const;
      const message = { recipient: profile.from, subject: 'Prueba de perfil | Intérpretes RD', text: 'Prueba de configuración. No contiene datos de postulantes.', html: '<p>Prueba de configuración. No contiene datos de postulantes.</p>' };
      const config = { apiKey: profile.apiKey, from: profile.from, replyTo: profile.replyTo || undefined };
      const reserved = await prisma.$transaction(async tx => {
        const active = await tx.$queryRaw<{ id: string }[]>`
          SELECT id::text FROM private_email.provider_profile WHERE id = ${id}::uuid AND retired_at IS NULL FOR SHARE
        `;
        return active.length === 1 && await reserveProviderQuota(tx, profile.provider) === 'reserved';
      });
      if (!reserved) return 'profile_test_blocked' as const;
      const smtp = profileSmtpConfig(profile);
      const outcome = profile.provider === 'brevo' ? await sendBrevoEmailDetailed(config, message)
        : profile.provider === 'resend' ? await sendResendEmail(config, message)
        : smtp ? await sendReservedSmtpProfile(smtp, message) : 'unconfirmed';
      if (outcome === 'accepted') {
        try {
          if (!await recordProfileAcceptance(prisma, id)) return 'accepted_evidence_missing' as const;
        } catch { return 'accepted_evidence_missing' as const; }
      }
      return outcome;
    } finally {
      testing = false;
    }
  } catch {
    return 'unavailable' as const;
  }
}

/** Confirmation means the administrator personally checked the inbox. */
export async function confirmSavedProviderReceipt(id: string) {
  try {
    const auth = await validateAction('admin');
    if ('error' in auth) return 'unauthorized' as const;
    if (availability() !== 'ready' || !providerSelectionPaused(process.env)) return 'disabled' as const;
    if (!validProfileId(id)) return 'invalid' as const;
    return await confirmProfileReceipt(prisma, id, auth.user.userId) ? 'receipt_confirmed' as const : 'selection_blocked' as const;
  } catch { return 'unavailable' as const; }
}

/** Preference only. Does not activate operational dispatch or change the ledger. */
export async function setPreferredEmailProvider(id: string | null) {
  try {
    const auth = await validateAction('admin');
    if ('error' in auth) return 'unauthorized' as const;
    if (availability() !== 'ready') return 'disabled' as const;
    if (id !== null && !validProfileId(id)) return 'invalid' as const;
    const result = await prisma.$transaction(tx => changeProviderPreference(tx, id, auth.user.userId, process.env));
    return result === 'saved' ? 'preferred_saved' as const : result === 'cleared' ? 'preference_cleared' as const
      : result === 'disabled' ? 'disabled' as const : 'selection_blocked' as const;
  } catch { return 'unavailable' as const; }
}

/** Changes only local budget ceilings, never billing, credentials or counters. */
export async function saveEmailProviderBudget(input: unknown) {
  try {
    const auth = await validateAction('admin');
    if ('error' in auth) return 'unauthorized' as const;
    if (availability() !== 'ready' || !providerSelectionPaused(process.env)) return 'disabled' as const;
    const budget = validateBudget(input);
    const revision = validateBudgetRevision(input);
    if (!budget || !revision) return 'budget_invalid' as const;
    return await updateProviderBudget(prisma, budget, auth.user.userId, revision) ? 'budget_saved' as const : 'budget_conflict' as const;
  } catch { return 'unavailable' as const; }
}

/** Retire a profile without changing any quota or delivery history. */
export async function retireSavedEmailProvider(id: string) {
  try {
    const auth = await validateAction('admin');
    if ('error' in auth) return 'unauthorized' as const;
    if (availability() !== 'ready' || !providerSelectionPaused(process.env)) return 'disabled' as const;
    if (!validProfileId(id)) return 'invalid' as const;
    return await prisma.$transaction(tx => retireProviderProfile(tx, id, auth.user.userId)) ? 'profile_retired' as const : 'invalid' as const;
  } catch { return 'unavailable' as const; }
}

export async function replaceSavedEmailProvider(input: unknown) {
  try {
    const auth = await validateAction('admin');
    if ('error' in auth) return 'unauthorized' as const;
    if (availability() !== 'ready' || !providerSelectionPaused(process.env)) return 'disabled' as const;
    const replacement = validateReplacement(input);
    if (!replacement) return 'invalid' as const;
    return await prisma.$transaction(tx => replaceProviderProfile(tx, replacement, auth.user.userId, key())) ? 'profile_replaced' as const : 'invalid' as const;
  } catch { return 'unavailable' as const; }
}

/** Copy only the current server-configured API provider, with no client secrets. */
export async function importConfiguredEmailProvider(): Promise<'imported' | 'already_saved' | 'blocked' | 'unauthorized' | 'unavailable'> {
  try {
    const auth = await validateAction('admin');
    if ('error' in auth) return 'unauthorized';
    if (availability() !== 'ready') return 'blocked';
    return await prisma.$transaction(tx => importEnvironmentProvider(tx, process.env, auth.user.userId));
  } catch { return 'unavailable'; }
}
