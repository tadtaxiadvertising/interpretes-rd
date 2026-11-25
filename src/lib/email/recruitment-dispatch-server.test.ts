// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ prisma: { $transaction: vi.fn() }, preferred: vi.fn(), reserve: vi.fn(), sendProfile: vi.fn(), config: vi.fn(), dispatch: vi.fn(), claim: vi.fn(), finish: vi.fn(), load: vi.fn(), send: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: mocks.prisma }));
vi.mock('./operational-config', () => ({ readOperationalMailConfig: mocks.config }));
vi.mock('./recruitment-dispatch', () => ({ dispatchRecruitmentEmail: mocks.dispatch }));
vi.mock('./recruitment-delivery-ledger', () => ({ claimRecruitmentEmail: mocks.claim, finishRecruitmentEmail: mocks.finish }));
vi.mock('./verified-binding-server', () => ({ loadVerifiedRecruitmentDispatch: mocks.load }));
vi.mock('./smtp-test', () => ({ sendRecruitmentSmtp: mocks.send }));
vi.mock('./preferred-provider-runtime', () => ({
  usesProviderVault: (env: Record<string, string>) => env.EMAIL_PROVIDER_SOURCE === 'vault',
  readPreferredProvider: mocks.preferred, reserveSelectedProvider: mocks.reserve, sendReservedProfile: mocks.sendProfile,
}));
import { processQueuedRecruitmentEmail } from './recruitment-dispatch-server';
import type { DispatchDependencies } from './recruitment-dispatch';

describe('recruitment SMTP adapter rollout gates', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-24T06:00:00Z'));
    vi.stubEnv('EMAIL_PROVIDER_SOURCE', '');
    vi.stubEnv('OPERATIONAL_EMAIL_DISPATCH_ENABLED', 'true');
    vi.stubEnv('OPERATIONAL_EMAIL_BINDING_ENABLED', 'true');
    vi.stubEnv('OPERATIONAL_EMAIL_GENERAL_ENABLED', 'true');
    vi.stubEnv('OPERATIONAL_EMAIL_PILOT_RECIPIENT', '');
    vi.stubEnv('OPERATIONAL_EMAIL_DISPATCH_NOT_BEFORE', '2026-11-24T05:00:00Z');
    mocks.config.mockReturnValue({ status: 'configured', provider: 'smtp' });
    mocks.dispatch.mockResolvedValue('accepted');
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
  it('requires independent enablement, binding enablement and valid SMTP configuration', async () => {
    vi.stubEnv('OPERATIONAL_EMAIL_DISPATCH_ENABLED', 'false');
    expect(await processQueuedRecruitmentEmail('event-1')).toBe('disabled');
    vi.stubEnv('OPERATIONAL_EMAIL_DISPATCH_ENABLED', 'true');
    vi.stubEnv('OPERATIONAL_EMAIL_BINDING_ENABLED', 'false');
    expect(await processQueuedRecruitmentEmail('event-1')).toBe('disabled');
    vi.stubEnv('OPERATIONAL_EMAIL_BINDING_ENABLED', 'true');
    mocks.config.mockReturnValue({ status: 'incomplete' });
    expect(await processQueuedRecruitmentEmail('event-1')).toBe('disabled');
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
  it('requires a past or present explicit UTC cutover', async () => {
    for (const value of ['', 'invalid', '2026-11-24T07:00:00Z']) {
      vi.stubEnv('OPERATIONAL_EMAIL_DISPATCH_NOT_BEFORE', value);
      expect(await processQueuedRecruitmentEmail('event-1')).toBe('disabled');
    }
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
  it('rejects a missing pilot and missing general authorization', async () => {
    vi.stubEnv('OPERATIONAL_EMAIL_GENERAL_ENABLED', 'false');
    expect(await processQueuedRecruitmentEmail('event-1')).toBe('disabled');
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
  it('filters older events and wires the committed ledger and SMTP adapters', async () => {
    expect(await processQueuedRecruitmentEmail('event-1')).toBe('accepted');
    const deps = mocks.dispatch.mock.calls[0][2] as DispatchDependencies;
    mocks.load.mockResolvedValueOnce({ event: { createdAt: new Date('2026-11-24T04:59:59Z') } });
    expect(await deps.load('event-1')).toBeNull();
    const recent = { event: { createdAt: new Date('2026-11-24T05:00:00Z') } };
    mocks.load.mockResolvedValueOnce(recent);
    expect(await deps.load('event-1')).toEqual(recent);
    await deps.claim('event-1');
    await deps.finish('event-1', 'accepted');
    expect(mocks.claim).toHaveBeenCalledWith(mocks.prisma, 'event-1', 'smtp');
    expect(mocks.finish).toHaveBeenCalledWith(mocks.prisma, 'event-1', 'accepted');
    expect(deps.send).toBe(mocks.send);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('never falls back to environment transport for an invalid source', async () => {
    vi.stubEnv('EMAIL_PROVIDER_SOURCE', 'vualt');
    expect(await processQueuedRecruitmentEmail('event-1')).toBe('disabled');
    expect(mocks.config).not.toHaveBeenCalled();
    expect(mocks.preferred).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
  it('never uses a vault profile for general dispatch', async () => {
    vi.stubEnv('EMAIL_PROVIDER_SOURCE', 'vault');
    expect(await processQueuedRecruitmentEmail('event-1')).toBe('disabled');
    expect(mocks.preferred).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
  it('fails closed without a selected and verified profile', async () => {
    vi.stubEnv('EMAIL_PROVIDER_SOURCE', 'vault');
    vi.stubEnv('OPERATIONAL_EMAIL_GENERAL_ENABLED', 'false');
    vi.stubEnv('OPERATIONAL_EMAIL_PILOT_RECIPIENT', 'pilot@example.test');
    mocks.preferred.mockResolvedValue(null);
    expect(await processQueuedRecruitmentEmail('event-1')).toBe('disabled');
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('rolls back claim when quota reservation fails, without calling either transport', async () => {
    vi.stubEnv('EMAIL_PROVIDER_SOURCE', 'vault');
    vi.stubEnv('OPERATIONAL_EMAIL_GENERAL_ENABLED', 'false');
    vi.stubEnv('OPERATIONAL_EMAIL_PILOT_RECIPIENT', 'pilot@example.test');
    const profile = { id: 'fixture', provider: 'brevo' };
    mocks.preferred.mockResolvedValue(profile);
    const tx = {};
    mocks.prisma.$transaction.mockImplementation(async callback => callback(tx));
    mocks.claim.mockResolvedValue({ eventId: 'event-1', kind: 'application_received' });
    mocks.reserve.mockResolvedValue(false);
    mocks.dispatch.mockImplementation(async (_id, _enabled, deps: DispatchDependencies) =>
      await deps.claim('event-1') ? 'accepted' : 'not_claimed');
    expect(await processQueuedRecruitmentEmail('event-1')).toBe('disabled');
    expect(mocks.claim).toHaveBeenCalledWith(tx, 'event-1', 'brevo');
    expect(mocks.reserve).toHaveBeenCalledWith(tx, profile);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.sendProfile).not.toHaveBeenCalled();
    expect(mocks.finish).not.toHaveBeenCalled();
    const transactionResult = mocks.prisma.$transaction.mock.results[0].value;
    await expect(transactionResult).rejects.toThrow('Provider budget unavailable');
  });
  it('does not reserve quota for an already claimed event', async () => {
    vi.stubEnv('EMAIL_PROVIDER_SOURCE', 'vault');
    vi.stubEnv('OPERATIONAL_EMAIL_GENERAL_ENABLED', 'false');
    vi.stubEnv('OPERATIONAL_EMAIL_PILOT_RECIPIENT', 'pilot@example.test');
    mocks.preferred.mockResolvedValue({ id: 'fixture', provider: 'brevo' });
    mocks.prisma.$transaction.mockImplementation(async callback => callback({}));
    mocks.claim.mockResolvedValue(null);
    mocks.dispatch.mockImplementation(async (_id, _enabled, deps: DispatchDependencies) =>
      await deps.claim('event-1') ? 'accepted' : 'not_claimed');
    expect(await processQueuedRecruitmentEmail('event-1')).toBe('not_claimed');
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

});
