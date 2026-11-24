// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { emailAutomationStatus } from './automation-status';

describe('email automation configuration projection', () => {
  it('reports all flags disabled for missing configuration', () => {
    expect(Object.values(emailAutomationStatus({})).every(value => !value)).toBe(true);
  });
  it('does not leak the scheduler secret and rejects impossible or future cutover dates', () => {
    const now = new Date('2026-11-24T06:00:00Z');
    const secret = 'a'.repeat(64);
    const env = { OPERATIONAL_EMAIL_SCHEDULER_SECRET: secret, OPERATIONAL_EMAIL_SCHEDULER_ENABLED: 'true', OPERATIONAL_EMAIL_DISPATCH_NOT_BEFORE: '2026-11-24T05:00:00Z' };
    const state = emailAutomationStatus(env, now);
    expect(state).toMatchObject({ schedulerCredentialConfigured: true, schedulerEnabled: true, cutoverValid: true });
    expect(JSON.stringify(state)).not.toContain(secret);
    for (const date of ['2026-02-30T05:00:00Z', '2026-11-24T07:00:00Z', 'invalid']) {
      expect(emailAutomationStatus({ ...env, OPERATIONAL_EMAIL_DISPATCH_NOT_BEFORE: date }, now).cutoverValid).toBe(false);
    }
  });
});
