import type { BrevoMailConfig } from './operational-config';

export type BrevoMessage = { recipient: string; subject: string; text: string; html: string };

/** Fixed HTTPS destination; never redirect credentials or automatically retry an ambiguous send. */
export type BrevoFailure = 'brevo_auth' | 'brevo_forbidden' | 'brevo_rejected' | 'brevo_rate_limited' | 'brevo_unavailable' | 'brevo_network' | 'brevo_response';
export type BrevoTestOutcome = 'accepted' | BrevoFailure;
function httpFailure(status: number): BrevoFailure {
  if (status === 401) return 'brevo_auth';
  if (status === 403) return 'brevo_forbidden';
  if (status === 429) return 'brevo_rate_limited';
  if (status >= 500) return 'brevo_unavailable';
  return status >= 400 && status < 500 ? 'brevo_rejected' : 'brevo_response';
}

export async function sendBrevoEmailDetailed(config: BrevoMailConfig, message: BrevoMessage): Promise<BrevoTestOutcome> {
  if (message.recipient.length > 254 || !/^[a-zA-Z0-9.!#$%&'*+/=?^_~|-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/.test(message.recipient)
    || /[\r\n]/.test(message.subject) || Buffer.byteLength(message.subject, 'utf8') > 120
    || Buffer.byteLength(message.text, 'utf8') + Buffer.byteLength(message.html, 'utf8') > 65536) return 'brevo_rejected';
  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
      headers: { 'api-key': config.apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { name: 'Intérpretes RD', email: config.from },
        to: [{ email: message.recipient }],
        subject: message.subject, textContent: message.text, htmlContent: message.html,
        ...(config.replyTo ? { replyTo: { email: config.replyTo } } : {}),
      }),
    });
    if (response.status !== 201) {
      await response.body?.cancel().catch(() => {});
      return httpFailure(response.status);
    }
    const data: unknown = await response.json();
    return data && typeof data === 'object' && 'messageId' in data && typeof data.messageId === 'string' && data.messageId.trim()
      ? 'accepted' : 'brevo_response';
  } catch {
    // No provider body, message ID, credentials or recipient in the returned result.
    return 'brevo_network';
  }
}

/** Preserve existing conservative ledger contract: no retries, no fallback. */
export async function sendBrevoEmail(config: BrevoMailConfig, message: BrevoMessage): Promise<'accepted' | 'unconfirmed'> {
  return await sendBrevoEmailDetailed(config, message) === 'accepted' ? 'accepted' : 'unconfirmed';
}

export type BrevoConnectionOutcome = 'brevo_ready' | 'brevo_sender_missing' | BrevoFailure;

/** Read-only runtime probe: the API key never leaves the fixed Brevo HTTPS origin. */
export async function checkBrevoConnection(config: BrevoMailConfig): Promise<BrevoConnectionOutcome> {
  try {
    const response = await fetch('https://api.brevo.com/v3/senders', {
      method: 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000),
      headers: { 'api-key': config.apiKey, accept: 'application/json' },
    });
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => {});
      return httpFailure(response.status);
    }
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || !('senders' in data) || !Array.isArray(data.senders)) return 'brevo_response';
    const active = data.senders.some(sender => sender && typeof sender === 'object' && sender.active === true
      && typeof sender.email === 'string' && sender.email.toLowerCase() === config.from.toLowerCase());
    return active ? 'brevo_ready' : 'brevo_sender_missing';
  } catch {
    return 'brevo_network';
  }
}
