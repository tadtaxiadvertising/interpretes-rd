// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ validateAction: vi.fn(), readEmailHistory: vi.fn(), prisma: {} }));
vi.mock('@/lib/auth/actions', () => ({ validateAction: mocks.validateAction }));
vi.mock('@/lib/prisma', () => ({ default: mocks.prisma }));
vi.mock('@/lib/email/delivery-history', () => ({ readEmailHistory: mocks.readEmailHistory }));
import { getCorporateEmailHistory } from './email-history';
describe('administrative email history authorization', () => {
  beforeEach(() => vi.resetAllMocks());
  it('denies unauthenticated/non-admin requests before reading', async () => {
    mocks.validateAction.mockResolvedValue({ error: 'denied' });
    expect(await getCorporateEmailHistory()).toEqual({ status: 'unauthorized' });
    expect(mocks.validateAction).toHaveBeenCalledWith('admin');
    expect(mocks.readEmailHistory).not.toHaveBeenCalled();
  });
  it('allows an authorized administrator to read the bounded report', async () => {
    mocks.validateAction.mockResolvedValue({ user: { role: 'admin' } });
    mocks.readEmailHistory.mockResolvedValue({ status: 'ready', rows: [] });
    expect(await getCorporateEmailHistory()).toEqual({ status: 'ready', rows: [] });
    expect(mocks.readEmailHistory).toHaveBeenCalledWith(mocks.prisma);
  });
});
