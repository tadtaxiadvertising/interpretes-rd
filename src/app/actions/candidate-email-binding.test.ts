// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ cookies: vi.fn(), verify: vi.fn(), createClient: vi.fn(), getUser: vi.fn(), link: vi.fn(), rate: vi.fn(), issue: vi.fn(), consume: vi.fn(), prisma: {} }));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('@/lib/prisma', () => ({ default: mocks.prisma }));
vi.mock('@/lib/recruitment/application-ref', () => ({ APPLICATION_REF_COOKIE: 'rd_app_ref', verifyApplicationRef: mocks.verify }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/email/link-candidate-account', () => ({ linkCandidateAccount: mocks.link }));
vi.mock('@/lib/security/rate-limit', () => ({ rateLimit: mocks.rate }));
vi.mock('@/lib/email/mailbox-proof', () => ({ issueMailboxChallenge: mocks.issue, consumeMailboxChallenge: mocks.consume }));
vi.mock('@/lib/email/operational-config', () => ({ readOperationalMailConfig: () => ({ status: 'configured' }) }));
vi.mock('@/lib/email/smtp-test', () => ({ sendRecruitmentSmtp: vi.fn() }));
import { enableCandidateEmailBinding, requestCandidateMailboxProof, confirmCandidateMailboxProof } from './candidate-email-binding';
describe('candidate binding action', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('OPERATIONAL_EMAIL_BINDING_ENABLED', 'true');
    mocks.cookies.mockResolvedValue({ get: () => ({ value: 'signed-ref' }) });
    mocks.verify.mockReturnValue({ candidateId: 1, applicationId: 'app-1', expiresAt: Date.now() + 60000 });
    mocks.createClient.mockResolvedValue({ auth: { getUser: mocks.getUser } });
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'account-1' } }, error: null });
    mocks.link.mockResolvedValue('linked');
    mocks.rate.mockReturnValue({ success: true });
    vi.stubEnv('OPERATIONAL_EMAIL_DISPATCH_ENABLED', 'true');
    vi.stubEnv('OPERATIONAL_EMAIL_PILOT_RECIPIENT', 'candidate@example.test');
    vi.stubEnv('OPERATIONAL_EMAIL_GENERAL_ENABLED', 'false');
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

describe('mailbox proof rate limits and identity', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('OPERATIONAL_EMAIL_BINDING_ENABLED', 'true');
    vi.stubEnv('OPERATIONAL_EMAIL_DISPATCH_ENABLED', 'true');
    vi.stubEnv('OPERATIONAL_EMAIL_PILOT_RECIPIENT', 'candidate@example.test');
    vi.stubEnv('OPERATIONAL_EMAIL_GENERAL_ENABLED', 'false');
    mocks.cookies.mockResolvedValue({ get: () => ({ value: 'signed-ref' }) });
    mocks.verify.mockReturnValue({ candidateId: 1, applicationId: 'app-1', expiresAt: Date.now() + 60000 });
    mocks.createClient.mockResolvedValue({ auth: { getUser: mocks.getUser } });
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'account-1', email: 'candidate@example.test' } }, error: null });
    mocks.link.mockResolvedValue('linked');
    mocks.rate.mockReturnValue({ success: true });
    mocks.issue.mockResolvedValue('sent');
    mocks.consume.mockResolvedValue('verified');
  });
  afterEach(() => vi.unstubAllEnvs());
  it('applies the global request limit before accessing cookies or auth', async () => {
    mocks.rate.mockReturnValueOnce({ success: false });
    expect(await requestCandidateMailboxProof()).toBe('not_available');
    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(mocks.issue).not.toHaveBeenCalled();
  });
  it('applies per-account limits before writing a binding', async () => {
    mocks.rate.mockReturnValueOnce({ success: true }).mockReturnValueOnce({ success: false });
    expect(await requestCandidateMailboxProof()).toBe('not_available');
    expect(mocks.link).not.toHaveBeenCalled();
    expect(mocks.issue).not.toHaveBeenCalled();
  });
  it('links automatically and requests proof for the server-derived mailbox', async () => {
    expect(await requestCandidateMailboxProof()).toBe('sent');
    expect(mocks.link).toHaveBeenCalledTimes(1);
    expect(mocks.issue).toHaveBeenCalledWith(mocks.prisma, { candidateId: 1, accountId: 'account-1', email: 'candidate@example.test' }, expect.any(Function));
  });
  it('rejects a different pilot recipient before writing', async () => {
    vi.stubEnv('OPERATIONAL_EMAIL_PILOT_RECIPIENT', 'other@example.test');
    expect(await requestCandidateMailboxProof()).toBe('not_available');
    expect(mocks.link).not.toHaveBeenCalled();
  });
  it('throttles confirmations before mutating the binding', async () => {
    mocks.rate.mockReturnValueOnce({ success: true }).mockReturnValueOnce({ success: false });
    expect(await confirmCandidateMailboxProof('a'.repeat(32))).toBe('invalid');
    expect(mocks.link).not.toHaveBeenCalled();
    expect(mocks.consume).not.toHaveBeenCalled();
  });
  it('consumes a valid token against the authenticated mailbox', async () => {
    expect(await confirmCandidateMailboxProof('a'.repeat(32))).toBe('verified');
    expect(mocks.consume).toHaveBeenCalledWith(mocks.prisma, { candidateId: 1, accountId: 'account-1', email: 'candidate@example.test' }, 'a'.repeat(32));
  });
});
