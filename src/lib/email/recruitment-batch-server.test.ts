// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ prisma: {}, readiness: vi.fn(), discover: vi.fn(), run: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: mocks.prisma }));
vi.mock('./database-readiness', () => ({ readEmailDatabaseReadiness: mocks.readiness }));
vi.mock('./operational-config', () => ({ readOperationalMailConfig: () => ({ status: 'configured' }) }));
vi.mock('./recruitment-batch-discovery', () => ({ discoverEmailEvents: mocks.discover }));
vi.mock('./recruitment-delivery-ledger', () => ({ enqueueRecruitmentEmail: vi.fn() }));
vi.mock('./recruitment-dispatch-server', () => ({ processQueuedRecruitmentEmail: vi.fn() }));
vi.mock('./recruitment-batch', () => ({ runEmailBatch: mocks.run, emptyBatch: (status: string) => ({ status, examined: 0, accepted: 0, deferred: 0, cancelled: 0, uncertain: 0 }) }));
describe('batch database preflight', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-24T08:00:00Z'));
    for (const flag of ['OPERATIONAL_EMAIL_BATCH_ENABLED', 'OPERATIONAL_EMAIL_DISPATCH_ENABLED', 'OPERATIONAL_EMAIL_BINDING_ENABLED']) vi.stubEnv(flag, 'true');
    vi.stubEnv('OPERATIONAL_EMAIL_GENERAL_ENABLED', 'true');
    vi.stubEnv('OPERATIONAL_EMAIL_PILOT_RECIPIENT', '');
    vi.stubEnv('OPERATIONAL_EMAIL_DISPATCH_NOT_BEFORE', '2026-11-24T07:00:00Z');
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
  it('never starts a batch if runtime database readiness fails', async () => {
    mocks.readiness.mockResolvedValue({ status: 'permission_mismatch' });
    const { processRecruitmentEmailBatch } = await import('./recruitment-batch-server');
    expect(await processRecruitmentEmailBatch()).toMatchObject({ status: 'unavailable', examined: 0 });
    expect(mocks.readiness).toHaveBeenCalledWith(mocks.prisma);
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.discover).not.toHaveBeenCalled();
  });
  it('starts a bounded batch only after a positive runtime preflight', async () => {
    mocks.readiness.mockResolvedValue({ status: 'ready' });
    mocks.run.mockResolvedValue({ status: 'completed', examined: 0 });
    const { processRecruitmentEmailBatch } = await import('./recruitment-batch-server');
    expect(await processRecruitmentEmailBatch()).toMatchObject({ status: 'completed' });
    expect(mocks.run).toHaveBeenCalledTimes(1);
  });
});
