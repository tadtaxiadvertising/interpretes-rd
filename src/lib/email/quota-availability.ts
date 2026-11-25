import type { ProviderQuota } from './provider-quota';

/** A snapshot of local reservations only, never the provider's actual account balance. */
export function quotaAvailability(quota: Pick<ProviderQuota, 'dailyUsed' | 'dailyLimit' | 'monthlyUsed' | 'monthlyLimit' | 'periodValid'>) {
  if (quota.periodValid === false) return { dailyRemaining: 0, monthlyRemaining: 0, remaining: 0, status: 'invalid_period' as const };
  const dailyRemaining = Math.max(0, quota.dailyLimit - quota.dailyUsed);
  const monthlyRemaining = Math.max(0, quota.monthlyLimit - quota.monthlyUsed);
  const remaining = Math.min(dailyRemaining, monthlyRemaining);
  const status: 'exhausted' | 'low' | 'available' = remaining === 0 ? 'exhausted'
    : dailyRemaining <= quota.dailyLimit * 0.2 || monthlyRemaining <= quota.monthlyLimit * 0.2 ? 'low'
    : 'available';
  return { dailyRemaining, monthlyRemaining, remaining, status };
}
