import { describe, expect, it } from 'vitest';
import { quotaAvailability } from './quota-availability';

describe('local quota availability', () => {
  const budget = { dailyLimit: 100, dailyUsed: 10, monthlyLimit: 500, monthlyUsed: 20 };
  it('uses the more restrictive of both local limits', () => {
    expect(quotaAvailability(budget)).toEqual({ dailyRemaining: 90, monthlyRemaining: 480, remaining: 90, status: 'available' });
    expect(quotaAvailability({ ...budget, monthlyUsed: 495 })).toEqual({ dailyRemaining: 90, monthlyRemaining: 5, remaining: 5, status: 'low' });
  });
  it('warns at 20 percent remaining and not before', () => {
    expect(quotaAvailability({ ...budget, dailyUsed: 80 }).status).toBe('low');
    expect(quotaAvailability({ ...budget, dailyUsed: 79 }).status).toBe('available');
  });
  it('clamps exhausted or reduced budgets to zero', () => {
    expect(quotaAvailability({ ...budget, dailyUsed: 110 })).toEqual({ dailyRemaining: 0, monthlyRemaining: 480, remaining: 0, status: 'exhausted' });
    expect(quotaAvailability({ ...budget, monthlyUsed: 500 }).status).toBe('exhausted');
  });
});
