// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendResendEmail } from './resend-transport';

const reserve = vi.hoisted(() => vi.fn());
vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('./provider-quota', () => ({ reserveProviderQuota: reserve }));

const config = { apiKey: 're_fixture-only-123', from: 'office@example.test', replyTo: 'support@example.test' };
const message = { recipient: 'candidate@example.test', subject: 'Intérpretes RD', text: 'Test', html: '<p>Test</p>' };
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); reserve.mockReset(); });

describe('Resend transport', () => {
  it('sends one message via the fixed HTTPS endpoint and requires an ID', async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'fixture' }), { status: 200 }));
    vi.stubGlobal('fetch', request);
    expect(await sendResendEmail(config, message)).toBe('accepted');
    expect(request).toHaveBeenCalledTimes(1);
    const [url, options] = request.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(options).toMatchObject({ method: 'POST', redirect: 'error', cache: 'no-store', headers: { Authorization: 'Bearer ' + config.apiKey } });
    expect(JSON.parse(options.body)).toEqual({ from: 'Intérpretes RD <office@example.test>', to: [message.recipient], subject: message.subject, text: message.text, html: message.html, reply_to: config.replyTo });
    expect(options.body).not.toContain(config.apiKey);
  });
  it.each([[401, 'resend_auth'], [403, 'resend_forbidden'], [429, 'resend_quota'], [422, 'resend_rejected'], [503, 'resend_unconfirmed']] as const)('does not retry status %s', async (status, outcome) => {
    const request = vi.fn().mockResolvedValue(new Response('private provider error', { status }));
    vi.stubGlobal('fetch', request);
    expect(await sendResendEmail(config, message)).toBe(outcome);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('rejects invalid recipient before making a request', async () => {
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    expect(await sendResendEmail(config, { ...message, recipient: 'a@example.test,b@example.test' })).toBe('resend_rejected');
    expect(request).not.toHaveBeenCalled();
  });
  it('does not infer acceptance from missing ID or network errors', async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 200 })).mockRejectedValueOnce(new Error('fixture'));
    vi.stubGlobal('fetch', request);
    expect(await sendResendEmail(config, message)).toBe('resend_unconfirmed');
    expect(await sendResendEmail(config, message)).toBe('resend_unconfirmed');
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('keeps dispatch disabled and sends the test only to the configured sender', async () => {
    vi.resetModules();
    reserve.mockResolvedValueOnce('reserved');
    vi.stubEnv('EMAIL_PROVIDER_SOURCE', 'environment');
    vi.stubEnv('OPERATIONAL_EMAIL_ENABLED', 'true');
    vi.stubEnv('OPERATIONAL_EMAIL_PROVIDER', 'resend');
    vi.stubEnv('RESEND_API_KEY', config.apiKey);
    vi.stubEnv('OPERATIONAL_EMAIL_FROM', config.from);
    vi.stubEnv('OPERATIONAL_EMAIL_REPLY_TO', '');
    vi.stubEnv('OPERATIONAL_EMAIL_DISPATCH_ENABLED', 'false');
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'fixture' }), { status: 200 }));
    vi.stubGlobal('fetch', request);
    const { sendOperationalMailTest, sendRecruitmentSmtp } = await import('./smtp-test');
    expect(await sendRecruitmentSmtp(message)).toBe('unconfirmed');
    expect(request).not.toHaveBeenCalled();
    expect(await sendOperationalMailTest()).toBe('accepted');
    expect(JSON.parse(request.mock.calls[0][1].body).to).toEqual([config.from]);
    expect(reserve).toHaveBeenCalledExactlyOnceWith({}, 'resend');
    expect(reserve.mock.invocationCallOrder[0]).toBeLessThan(request.mock.invocationCallOrder[0]);
    expect(await sendOperationalMailTest()).toBe('rate_limited');
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
