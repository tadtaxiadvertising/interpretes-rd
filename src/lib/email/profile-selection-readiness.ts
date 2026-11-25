import type { ProviderQuota } from './provider-quota';
import { quotaAvailability } from './quota-availability';

type ProfileEvidence = { retiredAt: string | null; testAcceptedAt: string | null; receiptConfirmedAt: string | null };

/** Advisory UI snapshot only. The server must recheck eligibility transactionally. */
export function profileSelectionReadiness(profile: ProfileEvidence, quota: ProviderQuota | undefined, preferenceEditable: boolean) {
  if (profile.retiredAt) return 'retired';
  if (!profile.testAcceptedAt) return 'test_required';
  if (!profile.receiptConfirmedAt) return 'receipt_required';
  if (!quota) return 'quota_unknown';
  if (quota.periodValid === false) return 'quota_invalid_period';
  if (quotaAvailability(quota).remaining === 0) return 'quota_exhausted';
  if (!preferenceEditable) return 'pause_required';
  return 'ready';
}
