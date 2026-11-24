'use server';

import { cookies } from 'next/headers';
import prisma from '@/lib/prisma';
import { createClient } from '@/lib/supabase/server';
import { APPLICATION_REF_COOKIE, verifyApplicationRef } from '@/lib/recruitment/application-ref';
import { emailDeliveryMode, pilotRecipient } from '@/lib/email/pilot-recipient';
import { issueMailboxChallenge, consumeMailboxChallenge, type MailboxChallengeResult, type MailboxProofResult } from '@/lib/email/mailbox-proof';
import { readOperationalMailConfig } from '@/lib/email/operational-config';
import { sendRecruitmentSmtp } from '@/lib/email/smtp-test';
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

async function resolveProofBinding() {
  if (process.env.OPERATIONAL_EMAIL_BINDING_ENABLED !== 'true'
    || emailDeliveryMode(process.env) === 'disabled') return null;
  const ref = verifyApplicationRef((await cookies()).get(APPLICATION_REF_COOKIE)?.value ?? null);
  if (!ref) return null;
  const { data, error } = await (await createClient()).auth.getUser();
  if (error || !data.user?.email) return null;
  const email = data.user.email.trim().toLowerCase();
  const pilot = pilotRecipient(process.env);
  if (pilot === false || (pilot && email !== pilot)) return null;
  if (!/^[a-zA-Z0-9.!#$%&'*+/=?^_~|-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/.test(email) || email.length > 254) return null;
  const linked = await linkCandidateAccount(prisma, ref, data.user);
  return linked === 'linked' || linked === 'already_linked'
    ? { candidateId: ref.candidateId, accountId: data.user.id, email } : null;
}

/** Explicit proof request; no client-provided recipient. */
export async function requestCandidateMailboxProof(): Promise<MailboxChallengeResult> {
  try {
    if (process.env.OPERATIONAL_EMAIL_DISPATCH_ENABLED !== 'true'
      || readOperationalMailConfig(process.env).status !== 'configured') return 'not_available';
    const binding = await resolveProofBinding();
    if (!binding || !rateLimit('mailbox-proof', { maxRequests: 10, windowMs: 60000, keyPrefix: 'email-proof' }).success) return 'not_available';
    return await issueMailboxChallenge(prisma, binding, (recipient, token) => sendRecruitmentSmtp({
      recipient, subject: 'Verifica tu correo | Intérpretes RD',
      text: 'Copia este código en tu portal de postulante: ' + token + '. Vence en 15 minutos. No lo compartas.',
      html: '<p>Copia este código en tu portal de postulante:</p><p><strong>' + token + '</strong></p><p>Vence en 15 minutos. No lo compartas.</p>',
    }));
  } catch { return 'unconfirmed'; }
}

export async function confirmCandidateMailboxProof(token: string): Promise<MailboxProofResult> {
  if (typeof token !== 'string' || !/^[0-9a-f]{32}$/.test(token)) return 'invalid';
  try {
    const binding = await resolveProofBinding();
    if (!binding) return 'invalid';
    return await consumeMailboxChallenge(prisma, binding, token);
  } catch { return 'unavailable'; }
}
