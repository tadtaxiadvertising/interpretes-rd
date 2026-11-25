'use server';

import prisma from '@/lib/prisma';
import { validateAction } from '@/lib/auth/actions';
import { inspectEmailPilot, type PilotPreflightReport } from '@/lib/email/pilot-preflight';
import { resolveOperationalMailEnv } from '@/lib/email/preferred-provider-runtime';
import { loadVerifiedRecruitmentDispatch } from '@/lib/email/verified-binding-server';

export async function checkCorporateEmailPilot(): Promise<PilotPreflightReport | { status: 'unauthorized' }> {
  try {
    const auth = await validateAction('admin');
    if ('error' in auth) return { status: 'unauthorized' };
    return await inspectEmailPilot(prisma, await resolveOperationalMailEnv(prisma, process.env), loadVerifiedRecruitmentDispatch);
  } catch {
    return { status: 'unavailable' };
  }
}
