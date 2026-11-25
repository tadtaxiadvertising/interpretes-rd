'use server';

import { validateAction } from '@/lib/auth/actions';
import { sendOperationalMailTest, type MailTestResult } from '@/lib/email/smtp-test';
import { checkBrevoConnection, type BrevoConnectionOutcome } from '@/lib/email/brevo-transport';
import { readOperationalMailConfig } from '@/lib/email/operational-config';

/** Server-side role guard, no recipient or message accepted from the client. */
export async function testCorporateSmtp(): Promise<MailTestResult | 'unauthorized'> {
  try {
    const auth = await validateAction('admin');
    if ('error' in auth) return 'unauthorized';
    return await sendOperationalMailTest();
  } catch {
    return 'unconfirmed';
  }
}

let nextProbeAt = 0;

/** Read-only, admin-only, fixed provider and sender, no client-supplied credentials. */
export async function checkCorporateBrevo(): Promise<BrevoConnectionOutcome | 'unauthorized' | 'disabled' | 'invalid' | 'incomplete' | 'rate_limited' | 'brevo_not_selected'> {
  try {
    const auth = await validateAction('admin');
    if ('error' in auth) return 'unauthorized';
    if (process.env.EMAIL_PROVIDER_SOURCE === 'vault') return 'brevo_not_selected';
    const result = readOperationalMailConfig(process.env);
    if (result.status !== 'configured') return result.status;
    if (result.provider !== 'brevo') return 'brevo_not_selected';
    if (Date.now() < nextProbeAt) return 'rate_limited';
    nextProbeAt = Date.now() + 15000;
    return await checkBrevoConnection(result.config);
  } catch {
    return 'brevo_network';
  }
}
