import { describe, expect, it } from 'vitest';
import { providerAlternatives } from './provider-alternatives';
import type { ProviderQuota } from './provider-quota';

const verified = { retiredAt: null, testAcceptedAt: 'accepted', receiptConfirmedAt: 'confirmed' };
const brevo = { ...verified, id: 'preferred', provider: 'brevo' as const };
const resend = { ...verified, id: 'backup', provider: 'resend' as const };
const quotas: ProviderQuota[] = [
  { provider: 'brevo', dailyLimit: 50, monthlyLimit: 1000, dailyUsed: 0, monthlyUsed: 0 },
  { provider: 'resend', dailyLimit: 100, monthlyLimit: 500, dailyUsed: 20, monthlyUsed: 480 },
];

describe('provider alternatives', () => {
  it('groups distinct providers without multiplying shared budgets', () => {
    const result = providerAlternatives([brevo, { ...brevo, id: 'same-provider' }, resend, { ...resend, id: 'backup-2' }], quotas, brevo.id);
    expect(result).toEqual({ providerKnown: true, sharedProfiles: 1, alternatives: [{ provider: 'resend', remaining: 20, profiles: 2 }] });
  });

  it('excludes retired, unverified and exhausted profiles', () => {
    const profiles = [brevo, { ...resend, retiredAt: 'retired' }, { ...resend, id: 'untested', testAcceptedAt: null }, { ...resend, id: 'unconfirmed', receiptConfirmedAt: null }];
    expect(providerAlternatives(profiles, quotas, brevo.id).alternatives).toEqual([]);
    expect(providerAlternatives([brevo, resend], [{ ...quotas[1], monthlyUsed: 500 }], brevo.id).alternatives).toEqual([]);
    expect(providerAlternatives([brevo, resend], [{ ...quotas[1], periodValid: false }], brevo.id).alternatives).toEqual([]);
    expect(providerAlternatives([brevo, resend], [], brevo.id).alternatives).toEqual([]);
  });

  it('does not claim independent alternatives if the selected profile is missing', () => {
    expect(providerAlternatives([resend], quotas, 'missing')).toEqual({ providerKnown: false, sharedProfiles: 0, alternatives: [] });
  });

  it('shows verified providers when no preference exists', () => {
    expect(providerAlternatives([resend, brevo], quotas, null).alternatives.map(item => item.provider)).toEqual(['brevo', 'resend']);
  });
});
