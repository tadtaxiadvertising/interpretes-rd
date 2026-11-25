'use server';

import prisma from '@/lib/prisma';
import { validateAction } from '@/lib/auth/actions';
import { rateLimit } from '@/lib/security/rate-limit';
import { inspectQuotaStorage } from '@/lib/email/quota-storage-readiness';
import { listProviderQuotas } from '@/lib/email/provider-quota';
import { quotaAvailability } from '@/lib/email/quota-availability';
import { providerSource } from '@/lib/email/provider-source';
import { emailDeliveryMode } from '@/lib/email/pilot-recipient';
import { isProviderId, providerIds } from '@/lib/email/provider-catalog';

export async function readNotificationEmailBudget() {
  try {
    const auth = await validateAction('admin');
    if ('error' in auth) return { status: 'unauthorized' as const };
    if (!rateLimit(auth.user.userId, { maxRequests: 6, windowMs: 60_000, keyPrefix: 'notification-email-budget' }).success) {
      return { status: 'rate_limited' as const };
    }
    const source = providerSource(process.env);
    const mode = emailDeliveryMode(process.env);
    const dispatchEnabled = process.env.OPERATIONAL_EMAIL_DISPATCH_ENABLED === 'true';
    const emailEnabled = process.env.OPERATIONAL_EMAIL_ENABLED === 'true';
    const vaultEnabled = process.env.EMAIL_PROVIDER_VAULT_ENABLED === 'true';
    const storage = await inspectQuotaStorage(prisma);
    const configured = process.env.OPERATIONAL_EMAIL_PROVIDER;
    const activeApiProvider: 'brevo' | 'resend' | null = source === 'environment' && (configured === 'brevo' || configured === 'resend') ? configured : null;
    const base = { source, mode, dispatchEnabled, emailEnabled, vaultEnabled, storage, activeApiProvider };
    if (storage !== 'ready') return { status: 'quota_unavailable' as const, ...base };
    try {
      // These counters represent locally reserved attempts, not external balance.
      // This query never retrieves credentials, sends mail or reserves quota.
      const quotas = await listProviderQuotas(prisma);
      const providers = providerIds.map(provider => {
        const matches = quotas.filter(q => isProviderId(q.provider) && q.provider === provider);
        const quota = matches.length === 1 ? matches[0] : undefined;
        if (!quota || ![quota.dailyUsed, quota.monthlyUsed, quota.dailyLimit, quota.monthlyLimit].every(n => Number.isSafeInteger(n) && n >= 0) ||
            quota.periodValid !== true) return { provider, availability: null };
        return { provider, availability: quotaAvailability(quota) };
      });
      return { status: 'ready' as const, ...base, providers, checkedAt: new Date().toISOString() };
    } catch {
      return { status: 'quota_unavailable' as const, ...base };
    }
  } catch {
    return { status: 'unavailable' as const };
  }
}
