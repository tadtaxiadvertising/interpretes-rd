import type { ResendMailConfig } from './operational-config';
import type { BrevoMessage } from './brevo-transport';

export type ResendFailure = 'resend_auth' | 'resend_forbidden' | 'resend_quota' | 'resend_rejected' | 'resend_unconfirmed';
export type ResendOutcome = 'accepted' | ResendFailure;

/** Explicit single-provider send. Never fall back or retry a possibly accepted message. */
export async function sendResendEmail(config: ResendMailConfig, message: BrevoMessage): Promise<ResendOutcome> {
  if (message.recipient.length > 254 || !/^[a-zA-Z0-9.!#$%&'*+/=?^_~|-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/.test(message.recipient)
    || /[\r\n]/.test(message.subject) || Buffer.byteLength(message.subject, 'utf8') > 120
    || Buffer.byteLength(message.text, 'utf8') + Buffer.byteLength(message.html, 'utf8') > 65536) return 'resend_rejected';
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000),
      headers: { Authorization: 'Bearer ' + config.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        from: 'Intérpretes RD <' + config.from + '>',
        to: [message.recipient], subject: message.subject, text: message.text, html: message.html,
        ...(config.replyTo ? { reply_to: config.replyTo } : {}),
      }),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      if (response.status === 401) return 'resend_auth';
      if (response.status === 403) return 'resend_forbidden';
      if (response.status === 429) return 'resend_quota';
      return response.status >= 400 && response.status < 500 ? 'resend_rejected' : 'resend_unconfirmed';
    }
    const data: unknown = await response.json();
    return data && typeof data === 'object' && 'id' in data && typeof data.id === 'string' && data.id.trim()
      ? 'accepted' : 'resend_unconfirmed';
  } catch {
    return 'resend_unconfirmed';
  }
}
