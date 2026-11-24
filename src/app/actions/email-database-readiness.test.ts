// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn(), prisma: {} }));
vi.mock('@/lib/prisma', () => ({ default: mocks.prisma }));
vi.mock('@/lib/auth/actions', () => ({ validateAction: mocks.auth }));
vi.mock('@/lib/email/database-readiness', () => ({ readEmailDatabaseReadiness: mocks.read }));
import { checkCorporateEmailDatabase } from './email-database-readiness';

describe('email database diagnostic authorization', () => {
  beforeEach(() => vi.resetAllMocks());
  it('rejects non-administrators before reading database metadata', async () => {
    mocks.auth.mockResolvedValue({ error: 'denied' });
    expect(await checkCorporateEmailDatabase()).toEqual({ status: 'unauthorized' });
    expect(mocks.auth).toHaveBeenCalledWith('admin');
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it('checks the runtime connection for an administrator', async () => {
    mocks.auth.mockResolvedValue({ user: { role: 'admin' } });
    mocks.read.mockResolvedValue({ status: 'not_installed' });
    expect(await checkCorporateEmailDatabase()).toEqual({ status: 'not_installed' });
    expect(mocks.read).toHaveBeenCalledWith(mocks.prisma);
  });
});
