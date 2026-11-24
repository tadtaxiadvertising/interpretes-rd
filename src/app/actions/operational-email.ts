'use server';

import { validateAction } from '@/lib/auth/actions';
import { sendOperationalMailTest, type MailTestResult } from '@/lib/email/smtp-test';

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
