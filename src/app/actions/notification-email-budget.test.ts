// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ auth: vi.fn(), limit: vi.fn(), quotas: vi.fn(), storage: vi.fn() }));
vi.mock('@/lib/auth/actions', () => ({ validateAction: m.auth }));
vi.mock('@/lib/security/rate-limit', () => ({ rateLimit: m.limit }));
vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/email/provider-quota', () => ({ listProviderQuotas: m.quotas }));
vi.mock('@/lib/email/quota-storage-readiness', () => ({ inspectQuotaStorage: m.storage }));
import { readNotificationEmailBudget } from './notification-email-budget';
import { expectTypeOf } from 'vitest';

beforeEach(() => {
  vi.resetAllMocks();
  m.auth.mockResolvedValue({ user: { userId: 'admin-account' } });
  m.limit.mockReturnValue({ success: true });
  m.quotas.mockResolvedValue([]);
  m.storage.mockResolvedValue('ready');
  vi.stubEnv('OPERATIONAL_EMAIL_PROVIDER', 'brevo');
  vi.stubEnv('EMAIL_PROVIDER_SOURCE', 'environment');
  vi.stubEnv('OPERATIONAL_EMAIL_ENABLED', 'true');
  vi.stubEnv('OPERATIONAL_EMAIL_DISPATCH_ENABLED', 'false');
  vi.stubEnv('OPERATIONAL_EMAIL_GENERAL_ENABLED', 'false');
  vi.stubEnv('OPERATIONAL_EMAIL_PILOT_RECIPIENT', '');
  vi.stubEnv('EMAIL_PROVIDER_VAULT_ENABLED', 'false');
  vi.stubEnv('BREVO_API_KEY', 'PRIVATE_API_KEY');
});
afterEach(() => vi.unstubAllEnvs());

describe('notification email budget', () => {
  it('preserves the narrow configured provider contract for the client', async () => {
    type Ready = Extract<Awaited<ReturnType<typeof readNotificationEmailBudget>>, { status: 'ready' }>;
    expectTypeOf<Ready['activeEnvironmentProvider']>().toEqualTypeOf<'brevo' | 'resend' | null>();
    for (const provider of ['brevo', 'resend', 'smtp', '__proto__', 'unknown']) {
      vi.stubEnv('OPERATIONAL_EMAIL_PROVIDER', provider);
      expect(await readNotificationEmailBudget()).toMatchObject({
        status: 'ready', activeEnvironmentProvider: provider === 'brevo' || provider === 'resend' ? provider : null,
      });
    }
  });

  it('requires administrative authorization and rate limits before querying counters', async () => {
    m.auth.mockResolvedValueOnce({ error: 'denied' });
    expect(await readNotificationEmailBudget()).toEqual({ status: 'unauthorized' });
    expect(m.auth).toHaveBeenCalledWith('admin');
    expect(m.limit).not.toHaveBeenCalled();
    m.limit.mockReturnValueOnce({ success: false });
    expect(await readNotificationEmailBudget()).toEqual({ status: 'rate_limited' });
    expect(m.quotas).not.toHaveBeenCalled();
    expect(m.storage).not.toHaveBeenCalled();
  });

  it('shows the restrictive local balance without disclosing credentials', async () => {
    m.quotas.mockResolvedValueOnce([
      { provider: 'brevo', dailyLimit: 300, dailyUsed: 240, monthlyLimit: 9000, monthlyUsed: 8990, periodValid: true },
      { provider: 'resend', dailyLimit: 100, dailyUsed: 100, monthlyLimit: 3000, monthlyUsed: 200, periodValid: true },
    ]);
    const result = await readNotificationEmailBudget();
    expect(result).toMatchObject({ status: 'ready', source: 'environment', emailEnabled: true, dispatchEnabled: false, storage: 'ready', activeEnvironmentProvider: 'brevo',
      providers: expect.arrayContaining([
        { provider: 'brevo', availability: { dailyRemaining: 60, monthlyRemaining: 10, remaining: 10, status: 'low' } },
        { provider: 'resend', availability: { dailyRemaining: 0, monthlyRemaining: 2800, remaining: 0, status: 'exhausted' } },
        { provider: 'mailjet', availability: null },
      ]),
    });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_API_KEY');
  });

  it('does not fabricate availability for missing, malformed or future-period counters', async () => {
    const quota = { dailyLimit: 300, dailyUsed: 0, monthlyLimit: 9000, monthlyUsed: 0, periodValid: true };
    m.quotas.mockResolvedValueOnce([
      { ...quota, provider: 'brevo', periodValid: false },
      { ...quota, provider: 'resend', dailyUsed: -1 },
      { ...quota, provider: 'smtp2go' }, { ...quota, provider: 'smtp2go' },
      { ...quota, provider: 'unknown' },
    ]);
    const result = await readNotificationEmailBudget();
    expect(result).toMatchObject({ status: 'ready' });
    if (result.status === 'ready') {
      expect(result.providers).toHaveLength(5);
      expect(result.providers.every(item => item.availability === null)).toBe(true);
    }
  });

  it('reports unavailable counters distinctly from zero and preserves transport controls', async () => {
    vi.stubEnv('EMAIL_PROVIDER_SOURCE', 'vault');
    vi.stubEnv('EMAIL_PROVIDER_VAULT_ENABLED', 'true');
    vi.stubEnv('OPERATIONAL_EMAIL_PILOT_RECIPIENT', 'private@example.test');
    m.quotas.mockRejectedValueOnce(new Error('PRIVATE_DATABASE_URL'));
    const result = await readNotificationEmailBudget();
    expect(result).toEqual({ status: 'quota_unavailable', source: 'vault', mode: 'pilot', emailEnabled: true, dispatchEnabled: false, vaultEnabled: true, storage: 'ready', activeEnvironmentProvider: null });
    expect(JSON.stringify(result)).not.toContain('private@example.test');
  });
  it.each(['not_installed', 'permission_mismatch', 'unavailable'])('does not read counters when quota storage is %s', async storage => {
    m.storage.mockResolvedValueOnce(storage);
    expect(await readNotificationEmailBudget()).toMatchObject({ status: 'quota_unavailable', storage, activeEnvironmentProvider: 'brevo' });
    expect(m.quotas).not.toHaveBeenCalled();
  });
  it('identifies a known SMTP provider without returning the configured host or login', async () => {
    vi.stubEnv('OPERATIONAL_EMAIL_PROVIDER', 'smtp');
    vi.stubEnv('OPERATIONAL_SMTP_HOST', 'MAIL.SMTP2GO.COM');
    vi.stubEnv('OPERATIONAL_SMTP_USER', 'private-login');
    const report = await readNotificationEmailBudget();
    expect(report).toMatchObject({ status: 'ready', activeEnvironmentProvider: 'smtp2go' });
    expect(JSON.stringify(report)).not.toContain('MAIL.SMTP2GO.COM');
    expect(JSON.stringify(report)).not.toContain('private-login');
    vi.stubEnv('OPERATIONAL_SMTP_HOST', 'mail.smtp2go.com.example.test');
    expect(await readNotificationEmailBudget()).toMatchObject({ status: 'ready', activeEnvironmentProvider: null });
  });
});
