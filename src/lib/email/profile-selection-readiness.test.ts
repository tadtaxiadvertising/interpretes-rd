import { describe, expect, it } from 'vitest';
import { profileSelectionReadiness } from './profile-selection-readiness';
import type { ProviderQuota } from './provider-quota';

const profile = { retiredAt: null, testAcceptedAt: 'accepted', receiptConfirmedAt: 'confirmed' };
const quota: ProviderQuota = { provider: 'brevo', dailyLimit: 100, monthlyLimit: 500, dailyUsed: 1, monthlyUsed: 2 };

describe('provider selection readiness snapshot', () => {
  it('requires active profile and both pieces of evidence', () => {
    expect(profileSelectionReadiness({ ...profile, retiredAt: 'retired' }, quota, true)).toBe('retired');
    expect(profileSelectionReadiness({ ...profile, testAcceptedAt: null }, quota, true)).toBe('test_required');
    expect(profileSelectionReadiness({ ...profile, receiptConfirmedAt: null }, quota, true)).toBe('receipt_required');
  });
  it('blocks missing or exhausted local budgets', () => {
    expect(profileSelectionReadiness(profile, undefined, true)).toBe('quota_unknown');
    expect(profileSelectionReadiness(profile, { ...quota, dailyUsed: 100 }, true)).toBe('quota_exhausted');
    expect(profileSelectionReadiness(profile, { ...quota, monthlyUsed: 501 }, true)).toBe('quota_exhausted');
  });
  it('requires pause and allows a low but positive budget', () => {
    expect(profileSelectionReadiness(profile, quota, false)).toBe('pause_required');
    expect(profileSelectionReadiness(profile, { ...quota, dailyUsed: 99 }, true)).toBe('ready');
  });
});
