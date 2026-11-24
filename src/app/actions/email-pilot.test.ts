// @vitest-environment node
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { emailDeliveryMode, pilotRecipient } from '@/lib/email/pilot-recipient';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), batch: vi.fn() }));
vi.mock('@/lib/auth/actions', () => ({ validateAction: mocks.auth }));
vi.mock('@/lib/email/recruitment-batch-server', () => ({ processRecruitmentEmailBatch: mocks.batch }));
import { runCorporateEmailPilot } from './email-pilot';

describe('controlled pilot', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('OPERATIONAL_EMAIL_PILOT_RECIPIENT', 'test@example.test');
    vi.stubEnv('OPERATIONAL_EMAIL_SCHEDULER_ENABLED', 'false');
    vi.stubEnv('OPERATIONAL_EMAIL_GENERAL_ENABLED', 'false');
    mocks.auth.mockResolvedValue({ user: { role: 'admin' } });
    mocks.batch.mockResolvedValue({ status: 'completed', examined: 1, accepted: 1 });
  });
  afterEach(() => vi.unstubAllEnvs());
  it('normalizes one mailbox and fails closed for malformed values', () => {
    expect(pilotRecipient({})).toBeNull();
    expect(pilotRecipient({ OPERATIONAL_EMAIL_PILOT_RECIPIENT: ' Test@Example.Test ' })).toBe('test@example.test');
    for (const value of ['a@example.test,b@example.test','a@example.test\nBcc: other@example.test',' ']) {
      expect(pilotRecipient({ OPERATIONAL_EMAIL_PILOT_RECIPIENT: value })).toBe(false);
    }
  });
  it('requires explicit mutually exclusive delivery modes', () => {
    expect(emailDeliveryMode({})).toBe('disabled');
    expect(emailDeliveryMode({ OPERATIONAL_EMAIL_PILOT_RECIPIENT: 'test@example.test' })).toBe('pilot');
    expect(emailDeliveryMode({ OPERATIONAL_EMAIL_GENERAL_ENABLED: 'true' })).toBe('general');
    expect(emailDeliveryMode({ OPERATIONAL_EMAIL_GENERAL_ENABLED: 'true', OPERATIONAL_EMAIL_PILOT_RECIPIENT: 'test@example.test' })).toBe('disabled');
  });
  it('denies non-admin access before processing', async () => {
    mocks.auth.mockResolvedValue({ error: 'denied' });
    expect(await runCorporateEmailPilot()).toEqual({ status: 'unauthorized' });
    expect(mocks.batch).not.toHaveBeenCalled();
  });
  it('requires an explicit pilot recipient and disabled scheduler', async () => {
    vi.stubEnv('OPERATIONAL_EMAIL_PILOT_RECIPIENT', '');
    expect((await runCorporateEmailPilot()).status).toBe('disabled');
    vi.stubEnv('OPERATIONAL_EMAIL_PILOT_RECIPIENT', 'test@example.test');
    vi.stubEnv('OPERATIONAL_EMAIL_SCHEDULER_ENABLED', 'true');
    expect((await runCorporateEmailPilot()).status).toBe('disabled');
    expect(mocks.batch).not.toHaveBeenCalled();
  });
  it('invokes the bounded batch only after authorization and configuration checks', async () => {
    expect(await runCorporateEmailPilot()).toMatchObject({ status: 'completed', examined: 1 });
    expect(mocks.batch).toHaveBeenCalledTimes(1);
  });
});
