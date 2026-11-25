'use server';

import { cookies } from 'next/headers';
import prisma from '@/lib/prisma';
import { createClient } from '@/lib/supabase/server';
import { APPLICATION_REF_COOKIE, verifyApplicationRef } from '@/lib/recruitment/application-ref';
import { emailDeliveryMode, pilotRecipient } from '@/lib/email/pilot-recipient';
import { issueMailboxChallenge, consumeMailboxChallenge, readMailboxState, readExistingProofBinding, type MailboxState, type MailboxChallengeResult, type MailboxProofResult } from '@/lib/email/mailbox-proof';
import { readOperationalMailConfig } from '@/lib/email/operational-config';
import { usesProviderVault, readPreferredProvider, reserveSelectedProvider, sendReservedProfile } from '@/lib/email/preferred-provider-runtime';
import { sendRecruitmentSmtp } from '@/lib/email/smtp-test';
import { isProtectedAdminEmail } from '@/lib/admin-identity';
import { rateLimit } from '@/lib/security/rate-limit';
import { linkCandidateAccount, type BindingResult } from '@/lib/email/link-candidate-account';

/** No client-supplied identity or application ID. Explicit opt-in only;
 * existing login and password setup remain independent of this action. */
export async function enableCandidateEmailBinding(): Promise<BindingResult | 'disabled'> {
  if (process.env.OPERATIONAL_EMAIL_BINDING_ENABLED !== 'true') return 'disabled';
  try {
    const cookieStore = await cookies();
    const ref = verifyApplicationRef(cookieStore.get(APPLICATION_REF_COOKIE)?.value ?? null);
    if (!ref) return 'not_eligible';
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return 'not_eligible';
    return await linkCandidateAccount(prisma, ref, data.user);
  } catch {
    return 'unavailable';
  }
}

async function resolveProofBinding(operation: 'request' | 'confirm') {
  if (process.env.OPERATIONAL_EMAIL_BINDING_ENABLED !== 'true'
    || emailDeliveryMode(process.env) === 'disabled') return null;
  const ref = verifyApplicationRef((await cookies()).get(APPLICATION_REF_COOKIE)?.value ?? null);
  const { data, error } = await (await createClient()).auth.getUser();
  if (error || !data.user?.email) return null;
  const email = data.user.email.trim().toLowerCase();
  const pilot = pilotRecipient(process.env);
  if (pilot === false || (pilot && email !== pilot)) return null;
  if (!/^[a-zA-Z0-9.!#$%&'*+/=?^_~|-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/.test(email) || email.length > 254) return null;
  // Limit authenticated requests before touching the binding table. Database
  // cooldown remains authoritative for sends across instances.
  if (!rateLimit(data.user.id, { maxRequests: operation === 'request' ? 3 : 10, windowMs: 60000, keyPrefix: 'email-proof-' + operation }).success) return null;
  if (!ref) {
    // Without the original signed reference, only a pre-existing explicit
    // UUID binding can be used; never create a binding from an email match.
    if (!isActiveProofSession(data.user)) return null;
    return await readExistingProofBinding(prisma, data.user.id, email);
  }
  const linked = await linkCandidateAccount(prisma, ref, data.user);
  return linked === 'linked' || linked === 'already_linked'
    ? { candidateId: ref.candidateId, accountId: data.user.id, email } : null;
}

/** Explicit proof request; no client-provided recipient. */
export async function requestCandidateMailboxProof(): Promise<MailboxChallengeResult> {
  try {
    if (process.env.OPERATIONAL_EMAIL_DISPATCH_ENABLED !== 'true'
      ) return 'not_available';
    const vault = usesProviderVault(process.env);
    if (vault && emailDeliveryMode(process.env) !== 'pilot') return 'not_available';
    const profile = vault ? await readPreferredProvider(prisma, process.env) : null;
    if (vault ? !profile : readOperationalMailConfig(process.env).status !== 'configured') return 'not_available';
    if (!rateLimit('global', { maxRequests: 30, windowMs: 60000, keyPrefix: 'email-proof-request-global' }).success) return 'not_available';
    const binding = await resolveProofBinding('request');
    if (!binding) return 'not_available';
    // Reserve before creating a challenge: exhausted quota must not leave an unsent code pending.
    if (profile && !await prisma.$transaction(tx => reserveSelectedProvider(tx, profile))) return 'not_available';
    const send = profile ? (message: { recipient: string; subject: string; text: string; html: string }) => sendReservedProfile(profile, message) : sendRecruitmentSmtp;
    return await issueMailboxChallenge(prisma, binding, (recipient, token) => send({
      recipient, subject: 'Verifica tu correo | Intérpretes RD',
      text: 'Copia este código en tu portal de postulante: ' + token + '. Vence en 15 minutos. No lo compartas.',
      html: '<p>Copia este código en tu portal de postulante:</p><p><strong>' + token + '</strong></p><p>Vence en 15 minutos. No lo compartas.</p>',
    }));
  } catch { return 'unconfirmed'; }
}

export async function confirmCandidateMailboxProof(token: string): Promise<MailboxProofResult> {
  if (typeof token !== 'string' || !/^[0-9a-f]{32}$/.test(token)) return 'invalid';
  try {
    if (!rateLimit('global', { maxRequests: 120, windowMs: 60000, keyPrefix: 'email-proof-confirm-global' }).success) return 'invalid';
    const binding = await resolveProofBinding('confirm');
    if (!binding) return 'invalid';
    return await consumeMailboxChallenge(prisma, binding, token);
  } catch { return 'unavailable'; }
}


/** Restore the display state after reload or sign-in on another device.
 * An existing explicit binding is required; no signed reference is needed
 * for this read, and no association is created from an email address. */
function isActiveProofSession(user: { id: string; email?: string; is_anonymous?: boolean; email_confirmed_at?: string; banned_until?: string }) {
  if (!user.email || user.is_anonymous || isProtectedAdminEmail(user.email)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id)) return false;
  const now = Date.now();
  const confirmed = Date.parse(user.email_confirmed_at ?? '');
  const banned = user.banned_until ? Date.parse(user.banned_until) : null;
  return Number.isFinite(confirmed) && confirmed <= now
    && (banned === null || (Number.isFinite(banned) && banned <= now));
}

export async function getCandidateMailboxState(): Promise<MailboxState> {
  if (process.env.OPERATIONAL_EMAIL_BINDING_ENABLED !== 'true'
    || emailDeliveryMode(process.env) === 'disabled') return 'unavailable';
  try {
    const { data, error } = await (await createClient()).auth.getUser();
    const user = data.user;
    if (error || !user?.email || !isActiveProofSession(user)) return 'unavailable';
    const email = user.email.trim().toLowerCase();
    const pilot = pilotRecipient(process.env);
    if (pilot === false || (pilot && pilot !== email)) return 'unavailable';
    if (!/^[a-zA-Z0-9.!#$%&'*+/=?^_~|-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/.test(email) || email.length > 254) return 'unavailable';
    if (!rateLimit(user.id, { maxRequests: 15, windowMs: 60000, keyPrefix: 'email-proof-status' }).success) return 'unavailable';
    return await readMailboxState(prisma, user.id, email);
  } catch { return 'unavailable'; }
}
