// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { emailAutomationStatus, emailRolloutReadiness } from './automation-status';

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

describe('mode-specific rollout readiness', () => {
  const now = new Date('2026-11-24T06:00:00Z');
  const configured = {
    OPERATIONAL_EMAIL_ENABLED: 'true',
    OPERATIONAL_SMTP_HOST: 'smtp.example.test',
    OPERATIONAL_SMTP_PORT: '587',
    OPERATIONAL_SMTP_USER: 'private-login',
    OPERATIONAL_SMTP_PASSWORD: 'test-only-secret',
    OPERATIONAL_EMAIL_FROM: 'office@example.test',
    OPERATIONAL_EMAIL_BINDING_ENABLED: 'true',
    OPERATIONAL_EMAIL_DISPATCH_ENABLED: 'true',
    OPERATIONAL_EMAIL_BATCH_ENABLED: 'true',
    OPERATIONAL_EMAIL_DISPATCH_NOT_BEFORE: '2026-11-24T05:00:00Z',
  };
  it('marks a correctly configured pilot ready without scheduler credentials', () => {
    const result = emailRolloutReadiness({ ...configured, OPERATIONAL_EMAIL_PILOT_RECIPIENT: 'candidate@example.test', OPERATIONAL_EMAIL_SCHEDULER_ENABLED: 'false' }, now);
    expect(result).toMatchObject({ mode: 'pilot', ready: true });
    expect(result.checks).toContainEqual(['Programador desactivado para el piloto', true]);
    expect(JSON.stringify(result)).not.toMatch(/candidate@example\.test|test-only-secret|private-login/);
  });
  it('does not mark a pilot with an enabled scheduler ready', () => {
    expect(emailRolloutReadiness({ ...configured, OPERATIONAL_EMAIL_PILOT_RECIPIENT: 'candidate@example.test', OPERATIONAL_EMAIL_SCHEDULER_ENABLED: 'true' }, now)).toMatchObject({ mode: 'pilot', ready: false });
  });
  it('requires a scheduler and its credential in general mode', () => {
    const env = { ...configured, OPERATIONAL_EMAIL_GENERAL_ENABLED: 'true', OPERATIONAL_EMAIL_SCHEDULER_ENABLED: 'true' };
    expect(emailRolloutReadiness(env, now)).toMatchObject({ mode: 'general', ready: false });
    expect(emailRolloutReadiness({ ...env, OPERATIONAL_EMAIL_SCHEDULER_SECRET: 'a'.repeat(64) }, now)).toMatchObject({ mode: 'general', ready: true });
  });
  it('keeps missing or conflicting modes blocked even when other controls pass', () => {
    expect(emailRolloutReadiness(configured, now)).toMatchObject({ mode: 'disabled', ready: false });
    expect(emailRolloutReadiness({ ...configured, OPERATIONAL_EMAIL_GENERAL_ENABLED: 'true', OPERATIONAL_EMAIL_PILOT_RECIPIENT: 'candidate@example.test' }, now)).toMatchObject({ mode: 'disabled', ready: false });
  });
});
