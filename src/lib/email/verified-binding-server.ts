import prisma from '@/lib/prisma';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { loadDispatchSnapshot } from './verified-binding';

/** Server-only adapter; no action or scheduled caller is enabled. */
export async function loadVerifiedRecruitmentDispatch(eventId: string) {
  return loadDispatchSnapshot(prisma, eventId, async (accountId) => {
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(accountId);
    if (error) throw new Error('Authoritative identity lookup unavailable');
    return data.user ?? null;
  });
}
