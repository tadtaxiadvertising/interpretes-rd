// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ cookies: vi.fn(), verify: vi.fn(), createClient: vi.fn(), getUser: vi.fn(), link: vi.fn(), prisma: {} }));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('@/lib/prisma', () => ({ default: mocks.prisma }));
vi.mock('@/lib/recruitment/application-ref', () => ({ APPLICATION_REF_COOKIE: 'rd_app_ref', verifyApplicationRef: mocks.verify }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/email/link-candidate-account', () => ({ linkCandidateAccount: mocks.link }));
import { enableCandidateEmailBinding } from './candidate-email-binding';
describe('candidate binding action', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('OPERATIONAL_EMAIL_BINDING_ENABLED', 'true');
    mocks.cookies.mockResolvedValue({ get: () => ({ value: 'signed-ref' }) });
    mocks.verify.mockReturnValue({ candidateId: 1, applicationId: 'app-1', expiresAt: Date.now() + 60000 });
    mocks.createClient.mockResolvedValue({ auth: { getUser: mocks.getUser } });
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'account-1' } }, error: null });
    mocks.link.mockResolvedValue('linked');
  });
  afterEach(() => vi.unstubAllEnvs());
  it('is disabled by default', async () => {
    vi.stubEnv('OPERATIONAL_EMAIL_BINDING_ENABLED', undefined);
    expect(await enableCandidateEmailBinding()).toBe('disabled');
    expect(mocks.cookies).not.toHaveBeenCalled();
  });
  it('rejects missing signed reference before accessing auth', async () => {
    mocks.verify.mockReturnValue(null);
    expect(await enableCandidateEmailBinding()).toBe('not_eligible');
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it('requires a fresh authenticated user', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: {} });
    expect(await enableCandidateEmailBinding()).toBe('not_eligible');
    expect(mocks.link).not.toHaveBeenCalled();
  });
  it('uses only server-derived identity and reference', async () => {
    expect(await enableCandidateEmailBinding()).toBe('linked');
    expect(mocks.verify).toHaveBeenCalledWith('signed-ref');
    expect(mocks.link).toHaveBeenCalledWith(mocks.prisma, expect.objectContaining({ candidateId: 1, applicationId: 'app-1' }), { id: 'account-1' });
  });
});
