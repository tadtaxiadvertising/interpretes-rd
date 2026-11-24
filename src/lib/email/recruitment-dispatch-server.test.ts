// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ prisma: {}, config: vi.fn(), dispatch: vi.fn(), claim: vi.fn(), finish: vi.fn(), load: vi.fn(), send: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: mocks.prisma }));
vi.mock('./operational-config', () => ({ readOperationalMailConfig: mocks.config }));
vi.mock('./recruitment-dispatch', () => ({ dispatchRecruitmentEmail: mocks.dispatch }));
vi.mock('./recruitment-delivery-ledger', () => ({ claimRecruitmentEmail: mocks.claim, finishRecruitmentEmail: mocks.finish }));
vi.mock('./verified-binding-server', () => ({ loadVerifiedRecruitmentDispatch: mocks.load }));
vi.mock('./smtp-test', () => ({ sendRecruitmentSmtp: mocks.send }));
import { processQueuedRecruitmentEmail } from './recruitment-dispatch-server';
import type { DispatchDependencies } from './recruitment-dispatch';

describe('recruitment SMTP adapter rollout gates', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-24T06:00:00Z'));
    vi.stubEnv('OPERATIONAL_EMAIL_DISPATCH_ENABLED', 'true');
    vi.stubEnv('OPERATIONAL_EMAIL_BINDING_ENABLED', 'true');
    vi.stubEnv('OPERATIONAL_EMAIL_DISPATCH_NOT_BEFORE', '2026-11-24T05:00:00Z');
    mocks.config.mockReturnValue({ status: 'configured' });
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
    expect(mocks.claim).toHaveBeenCalledWith(mocks.prisma, 'event-1');
    expect(mocks.finish).toHaveBeenCalledWith(mocks.prisma, 'event-1', 'accepted');
    expect(deps.send).toBe(mocks.send);
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
