'use server';

import { cookies } from 'next/headers';
import prisma from '@/lib/prisma';
import { createClient } from '@/lib/supabase/server';
import { APPLICATION_REF_COOKIE, verifyApplicationRef } from '@/lib/recruitment/application-ref';
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
