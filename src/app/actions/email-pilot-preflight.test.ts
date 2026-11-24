// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), inspect: vi.fn(), load: vi.fn(), prisma: {} }));
vi.mock('@/lib/auth/actions', () => ({ validateAction: mocks.auth }));
vi.mock('@/lib/prisma', () => ({ default: mocks.prisma }));
vi.mock('@/lib/email/pilot-preflight', () => ({ inspectEmailPilot: mocks.inspect }));
vi.mock('@/lib/email/verified-binding-server', () => ({ loadVerifiedRecruitmentDispatch: mocks.load }));
import { checkCorporateEmailPilot } from './email-pilot-preflight';

describe('pilot diagnostic action', () => {
  beforeEach(() => vi.resetAllMocks());
  it('rejects unauthorized calls before accessing the diagnosis', async () => {
    mocks.auth.mockResolvedValue({ error: 'denied' });
    expect(await checkCorporateEmailPilot()).toEqual({ status: 'unauthorized' });
    expect(mocks.inspect).not.toHaveBeenCalled();
  });
  it('uses only server configuration and the authoritative identity loader', async () => {
    mocks.auth.mockResolvedValue({ user: { role: 'admin' } });
    mocks.inspect.mockResolvedValue({ status: 'ready' });
    expect(await checkCorporateEmailPilot()).toEqual({ status: 'ready' });
    expect(mocks.inspect).toHaveBeenCalledExactlyOnceWith(mocks.prisma, process.env, mocks.load);
  });
});
