// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendBrevoEmail, sendBrevoEmailDetailed, checkBrevoConnection } from './brevo-transport';

const reserve = vi.hoisted(() => vi.fn());
vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('./provider-quota', () => ({ reserveProviderQuota: reserve }));

const config = { apiKey: 'fake-fixture-key-only', from: 'office@example.test', replyTo: 'support@example.test' };
const message = { recipient: 'candidate@example.test', subject: 'Intérpretes RD', text: 'Test', html: '<p>Test</p>' };
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); reserve.mockReset(); });

describe('Brevo transactional transport', () => {
  it('sends one branded message to the fixed HTTPS endpoint without redirects', async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messageId: 'fixture-id' }), { status: 201 }));
    vi.stubGlobal('fetch', request);
    expect(await sendBrevoEmail(config, message)).toBe('accepted');
    expect(request).toHaveBeenCalledTimes(1);
    const [url, options] = request.mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(options).toMatchObject({ method: 'POST', redirect: 'error', cache: 'no-store', headers: { 'api-key': config.apiKey } });
    expect(JSON.parse(options.body)).toEqual({
      sender: { name: 'Intérpretes RD', email: config.from },
      to: [{ email: message.recipient }], subject: message.subject,
      textContent: message.text, htmlContent: message.html, replyTo: { email: config.replyTo },
    });
    expect(options.body).not.toContain(config.apiKey);
  });
  it.each([401, 403, 429, 500])('does not retry HTTP %s', async status => {
    const request = vi.fn().mockResolvedValue(new Response('private provider error', { status }));
    vi.stubGlobal('fetch', request);
    expect(await sendBrevoEmail(config, message)).toBe('unconfirmed');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('requires a successful response containing a message ID', async () => {
    const request = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
    vi.stubGlobal('fetch', request);
    expect(await sendBrevoEmail(config, message)).toBe('unconfirmed');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('sanitizes network errors without retrying', async () => {
    const request = vi.fn().mockRejectedValue(new Error('private details'));
    vi.stubGlobal('fetch', request);
    expect(await sendBrevoEmail(config, message)).toBe('unconfirmed');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('rejects invalid recipient or injected subject before network access', async () => {
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    expect(await sendBrevoEmail(config, { ...message, recipient: 'a@example.test,b@example.test' })).toBe('unconfirmed');
    expect(await sendBrevoEmail(config, { ...message, subject: 'bad\r\nBcc: other@example.test' })).toBe('unconfirmed');
    expect(request).not.toHaveBeenCalled();
  });
  it('uses only the configured sender for the administrative test and keeps dispatch disabled', async () => {
    vi.resetModules();
    reserve.mockResolvedValueOnce('reserved');
    vi.stubEnv('EMAIL_PROVIDER_SOURCE', 'environment');
    vi.stubEnv('OPERATIONAL_EMAIL_ENABLED', 'true');
    vi.stubEnv('OPERATIONAL_EMAIL_PROVIDER', 'brevo');
    vi.stubEnv('BREVO_API_KEY', config.apiKey);
    vi.stubEnv('OPERATIONAL_EMAIL_FROM', config.from);
    vi.stubEnv('OPERATIONAL_EMAIL_REPLY_TO', '');
    vi.stubEnv('OPERATIONAL_EMAIL_DISPATCH_ENABLED', 'false');
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messageId: 'fixture' }), { status: 201 }));
    vi.stubGlobal('fetch', request);
    const { sendOperationalMailTest, sendRecruitmentSmtp } = await import('./smtp-test');
    expect(await sendRecruitmentSmtp(message)).toBe('unconfirmed');
    expect(request).not.toHaveBeenCalled();
    expect(await sendOperationalMailTest()).toBe('accepted');
    expect(JSON.parse(request.mock.calls[0][1].body).to).toEqual([{ email: config.from }]);
    expect(reserve).toHaveBeenCalledExactlyOnceWith({}, 'brevo');
    expect(reserve.mock.invocationCallOrder[0]).toBeLessThan(request.mock.invocationCallOrder[0]);
    expect(await sendOperationalMailTest()).toBe('rate_limited');
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('safe runtime diagnostics', () => {
  it.each([
    [401, 'brevo_auth'], [403, 'brevo_forbidden'], [400, 'brevo_rejected'],
    [429, 'brevo_rate_limited'], [503, 'brevo_unavailable'],
  ] as const)('classifies HTTP %s without leaking provider details', async (status, expected) => {
    const request = vi.fn().mockResolvedValue(new Response('private detail', { status }));
    vi.stubGlobal('fetch', request);
    expect(await sendBrevoEmailDetailed(config, message)).toBe(expected);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('checks the active sender over GET, without sending any email', async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ senders: [
      { email: 'other@example.test', active: true },
      { email: 'OFFICE@example.test', active: true },
    ] }), { status: 200 }));
    vi.stubGlobal('fetch', request);
    expect(await checkBrevoConnection(config)).toBe('brevo_ready');
    expect(request).toHaveBeenCalledExactlyOnceWith('https://api.brevo.com/v3/senders', expect.objectContaining({
      method: 'GET', redirect: 'error', cache: 'no-store', headers: { 'api-key': config.apiKey, accept: 'application/json' },
    }));
    expect(request.mock.calls[0][1].body).toBeUndefined();
  });
  it('rejects inactive or absent senders', async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ senders: [
      { email: config.from, active: false }, { email: 'other@example.test', active: true },
    ] }), { status: 200 }));
    vi.stubGlobal('fetch', request);
    expect(await checkBrevoConnection(config)).toBe('brevo_sender_missing');
  });
  it('does not confuse a malformed response with a verified connection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    expect(await checkBrevoConnection(config)).toBe('brevo_response');
  });
  it('reports network failures conservatively', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private details')));
    expect(await checkBrevoConnection(config)).toBe('brevo_network');
  });
});
