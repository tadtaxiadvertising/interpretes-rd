// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ cookies: vi.fn(), verify: vi.fn(), createClient: vi.fn(), getUser: vi.fn(), link: vi.fn(), rate: vi.fn(), issue: vi.fn(), consume: vi.fn(), state: vi.fn(), existing: vi.fn(), prisma: {} }));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('@/lib/prisma', () => ({ default: mocks.prisma }));
vi.mock('@/lib/recruitment/application-ref', () => ({ APPLICATION_REF_COOKIE: 'rd_app_ref', verifyApplicationRef: mocks.verify }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/email/link-candidate-account', () => ({ linkCandidateAccount: mocks.link }));
vi.mock('@/lib/security/rate-limit', () => ({ rateLimit: mocks.rate }));
vi.mock('@/lib/email/mailbox-proof', () => ({ issueMailboxChallenge: mocks.issue, consumeMailboxChallenge: mocks.consume, readMailboxState: mocks.state, readExistingProofBinding: mocks.existing }));
vi.mock('@/lib/email/operational-config', () => ({ readOperationalMailConfig: () => ({ status: 'configured' }) }));
vi.mock('@/lib/email/smtp-test', () => ({ sendRecruitmentSmtp: vi.fn() }));
import { enableCandidateEmailBinding, requestCandidateMailboxProof, confirmCandidateMailboxProof, getCandidateMailboxState } from './candidate-email-binding';
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


describe('read-only mailbox state', () => {
  const id = '123e4567-e89b-42d3-a456-426614174000';
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('OPERATIONAL_EMAIL_BINDING_ENABLED', 'true');
    vi.stubEnv('OPERATIONAL_EMAIL_PILOT_RECIPIENT', 'candidate@example.test');
    vi.stubEnv('OPERATIONAL_EMAIL_GENERAL_ENABLED', 'false');
    mocks.createClient.mockResolvedValue({ auth: { getUser: mocks.getUser } });
    mocks.getUser.mockResolvedValue({ data: { user: { id, email: 'candidate@example.test', email_confirmed_at: '2025-01-01T00:00:00Z' } }, error: null });
    mocks.rate.mockReturnValue({ success: true });
    mocks.state.mockResolvedValue('verified');
  });
  afterEach(() => vi.unstubAllEnvs());
  it('restores existing proof without cookie, binding mutation or email send', async () => {
    expect(await getCandidateMailboxState()).toBe('verified');
    expect(mocks.state).toHaveBeenCalledWith(mocks.prisma, id, 'candidate@example.test');
    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(mocks.link).not.toHaveBeenCalled();
    expect(mocks.issue).not.toHaveBeenCalled();
  });
  it('continues proof on a new device without creating a new binding', async () => {
    mocks.cookies.mockResolvedValue({ get: () => undefined });
    mocks.verify.mockReturnValue(null);
    mocks.existing.mockResolvedValue({ candidateId: 1, accountId: id, email: 'candidate@example.test' });
    mocks.consume.mockResolvedValue('verified');
    expect(await confirmCandidateMailboxProof('a'.repeat(32))).toBe('verified');
    expect(mocks.existing).toHaveBeenCalledWith(mocks.prisma, id, 'candidate@example.test');
    expect(mocks.link).not.toHaveBeenCalled();
  });
  it('cannot create a binding on a new device without a signed reference', async () => {
    mocks.cookies.mockResolvedValue({ get: () => undefined });
    mocks.verify.mockReturnValue(null);
    mocks.existing.mockResolvedValue(null);
    expect(await confirmCandidateMailboxProof('a'.repeat(32))).toBe('invalid');
    expect(mocks.link).not.toHaveBeenCalled();
    expect(mocks.consume).not.toHaveBeenCalled();
  });
  it('does not expose state for an unauthorized pilot recipient', async () => {
    vi.stubEnv('OPERATIONAL_EMAIL_PILOT_RECIPIENT', 'other@example.test');
    expect(await getCandidateMailboxState()).toBe('unavailable');
    expect(mocks.state).not.toHaveBeenCalled();
  });
  it('rejects unconfirmed accounts and rate-limited sessions', async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: { id, email: 'candidate@example.test' } }, error: null });
    expect(await getCandidateMailboxState()).toBe('unavailable');
    mocks.rate.mockReturnValueOnce({ success: false });
    expect(await getCandidateMailboxState()).toBe('unavailable');
    expect(mocks.state).not.toHaveBeenCalled();
  });
  it('treats database failures as unavailable without changing access', async () => {
    mocks.state.mockRejectedValue(new Error('database unavailable'));
    expect(await getCandidateMailboxState()).toBe('unavailable');
    expect(mocks.link).not.toHaveBeenCalled();
  });
});
