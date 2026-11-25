// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { validateBudget, updateProviderBudget } from './provider-budget';

describe('local provider budgets', () => {
  it('accepts only supported provider and bounded integer limits', () => {
    expect(validateBudget({ provider: 'brevo', dailyLimit: 300, monthlyLimit: 9300 })).toEqual({ provider: 'brevo', dailyLimit: 300, monthlyLimit: 9300 });
    expect(validateBudget({ provider: 'resend', dailyLimit: 100, monthlyLimit: 3000 })).not.toBeNull();
    for (const input of [
      null, {}, { provider: 'smtp', dailyLimit: 1, monthlyLimit: 1 },
      { provider: 'brevo', dailyLimit: 301, monthlyLimit: 1000 },
      { provider: 'resend', dailyLimit: 101, monthlyLimit: 1000 },
      { provider: 'resend', dailyLimit: 1, monthlyLimit: 3001 },
      { provider: 'brevo', dailyLimit: 1, monthlyLimit: 9301 },
      { provider: 'brevo', dailyLimit: 0, monthlyLimit: 1000 },
      { provider: 'brevo', dailyLimit: 1.5, monthlyLimit: 1000 },
      { provider: 'brevo', dailyLimit: '50', monthlyLimit: 1000 },
      { provider: 'brevo', dailyLimit: 1, monthlyLimit: Infinity },
    ]) expect(validateBudget(input)).toBeNull();
  });
  it('does not query with invalid limits or missing audit actor', async () => {
    const db = { $queryRaw: vi.fn() };
    expect(await updateProviderBudget(db, { provider: 'resend', dailyLimit: 101, monthlyLimit: 1 }, 'admin-fixture')).toBe(false);
    expect(await updateProviderBudget(db, { provider: 'resend', dailyLimit: 1, monthlyLimit: 1 }, '')).toBe(false);
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
  it('requires exactly one audited update', async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ provider: 'resend' }]) };
    const input = { provider: 'resend' as const, dailyLimit: 1, monthlyLimit: 1 };
    expect(await updateProviderBudget(db, input, 'admin-fixture')).toBe(false);
    expect(await updateProviderBudget(db, input, 'admin-fixture')).toBe(true);
  });
});
