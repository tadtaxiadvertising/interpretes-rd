// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { smtpTestCurlConfig, smtpTestMessage, sendOperationalMailTest, sendRecruitmentSmtp } from './smtp-test';
import { sendBrevoEmail, sendBrevoEmailDetailed } from './brevo-transport';
vi.mock('./brevo-transport', () => ({ sendBrevoEmail: vi.fn(), sendBrevoEmailDetailed: vi.fn() }));
const quota = vi.hoisted(() => vi.fn());
vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('./provider-quota', () => ({ reserveProviderQuota: quota }));
import type { OperationalMailConfig } from './operational-config';

const config: OperationalMailConfig = {
  host: 'smtp.example.test', port: 587, secure: false, requireTLS: true,
  user: 'office@example.test', password: 'test"\\secret', from: 'office@example.test',
};

describe('corporate SMTP test payload', () => {
  it('uses only the configured sender as recipient and escapes config credentials', () => {
    const result = smtpTestCurlConfig(config);
    expect(result).toContain('url = "smtp://smtp.example.test:587"');
    expect(result).toContain('mail-from = "office@example.test"');
    expect(result).toContain('mail-rcpt = "office@example.test"');
    expect(result).toContain('user = "office@example.test:test\\"\\\\secret"');
  });
  it('uses implicit TLS on port 465', () => {
    expect(smtpTestCurlConfig({ ...config, port: 465, secure: true, requireTLS: false })).toContain('smtps://smtp.example.test:465');
  });
  it('rejects control characters and ambiguous usernames', () => {
    expect(() => smtpTestCurlConfig({ ...config, password: 'bad\nmail-rcpt = victim' })).toThrow();
    expect(() => smtpTestCurlConfig({ ...config, user: 'bad:user' })).toThrow();
  });
  it('builds a branded MIME message without credentials or candidate data', () => {
    const message = smtpTestMessage(config);
    expect(message).toContain('To: office@example.test\r\n');
    expect(message).toContain('From: =?UTF-8?B?' + Buffer.from('Intérpretes RD').toString('base64') + '?=');
    expect(message).toContain('Content-Transfer-Encoding: base64');
    expect(message).not.toContain(config.password);
    const body = message.split('\r\n\r\n')[1];
    expect(Buffer.from(body, 'base64').toString('utf8')).toContain('No contiene datos de postulantes');
  });
});

describe('environment transport source guard', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
  it.each(['vualt', 'vault', ' environment '])('blocks direct sends and tests for source %s', async source => {
    vi.stubEnv('EMAIL_PROVIDER_SOURCE', source);
    vi.stubEnv('OPERATIONAL_EMAIL_ENABLED', 'true');
    vi.stubEnv('OPERATIONAL_EMAIL_DISPATCH_ENABLED', 'true');
    vi.stubEnv('OPERATIONAL_EMAIL_PROVIDER', 'brevo');
    vi.stubEnv('BREVO_API_KEY', 'fixture-key-123456789');
    vi.stubEnv('OPERATIONAL_EMAIL_FROM', 'fixture@example.test');
    vi.mocked(sendBrevoEmail).mockResolvedValue('accepted');
    vi.mocked(sendBrevoEmailDetailed).mockResolvedValue('accepted');
    expect(await sendRecruitmentSmtp({ recipient: 'fixture@example.test', subject: 'Fixture', text: 'Fixture', html: '<p>Fixture</p>' })).toBe('unconfirmed');
    expect(await sendOperationalMailTest()).toBe('disabled');
    expect(sendBrevoEmail).not.toHaveBeenCalled();
    expect(sendBrevoEmailDetailed).not.toHaveBeenCalled();
  });
});

describe('environment test budget protection', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); vi.resetAllMocks(); });
  it('blocks exhausted or unavailable budgets and consumes one attempt before an authorized test', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-25T21:00:00Z'));
    vi.stubEnv('EMAIL_PROVIDER_SOURCE', 'environment');
    vi.stubEnv('OPERATIONAL_EMAIL_ENABLED', 'true');
    vi.stubEnv('OPERATIONAL_EMAIL_PROVIDER', 'brevo');
    vi.stubEnv('BREVO_API_KEY', 'fixture-key-123456789');
    vi.stubEnv('OPERATIONAL_EMAIL_FROM', 'fixture@example.test');
    quota.mockResolvedValueOnce('quota_reached').mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce('reserved');
    expect(await sendOperationalMailTest()).toBe('local_quota_reached');
    expect(sendBrevoEmailDetailed).not.toHaveBeenCalled();
    expect(await sendOperationalMailTest()).toBe('rate_limited');
    expect(quota).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-11-25T21:01:00Z'));
    expect(await sendOperationalMailTest()).toBe('local_quota_unavailable');
    expect(sendBrevoEmailDetailed).not.toHaveBeenCalled();
    vi.setSystemTime(new Date('2026-11-25T21:02:00Z'));
    vi.mocked(sendBrevoEmailDetailed).mockResolvedValueOnce('accepted');
    expect(await sendOperationalMailTest()).toBe('accepted');
    expect(quota).toHaveBeenLastCalledWith({}, 'brevo');
    expect(quota.mock.invocationCallOrder[2]).toBeLessThan(vi.mocked(sendBrevoEmailDetailed).mock.invocationCallOrder[0]);
    expect(sendBrevoEmailDetailed).toHaveBeenCalledTimes(1);
  });
  it('blocks known SMTP tests before any network attempt when quota is exhausted', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-26T21:00:00Z'));
    vi.stubEnv('EMAIL_PROVIDER_SOURCE', 'environment');
    vi.stubEnv('OPERATIONAL_EMAIL_ENABLED', 'true');
    vi.stubEnv('OPERATIONAL_EMAIL_PROVIDER', 'smtp');
    vi.stubEnv('OPERATIONAL_SMTP_HOST', 'in-v3.mailjet.com');
    vi.stubEnv('OPERATIONAL_SMTP_PORT', '587');
    vi.stubEnv('OPERATIONAL_SMTP_USER', 'fixture-user');
    vi.stubEnv('OPERATIONAL_SMTP_PASSWORD', 'fixture-password');
    vi.stubEnv('OPERATIONAL_EMAIL_FROM', 'fixture@example.test');
    quota.mockResolvedValueOnce('quota_reached');
    expect(await sendOperationalMailTest()).toBe('local_quota_reached');
    expect(quota).toHaveBeenCalledExactlyOnceWith({}, 'mailjet');
  });
});
