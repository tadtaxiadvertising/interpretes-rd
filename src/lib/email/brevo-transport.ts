import type { BrevoMailConfig } from './operational-config';

export type BrevoMessage = { recipient: string; subject: string; text: string; html: string };

/** Fixed HTTPS destination; never redirect credentials or automatically retry an ambiguous send. */
export async function sendBrevoEmail(config: BrevoMailConfig, message: BrevoMessage): Promise<'accepted' | 'unconfirmed'> {
  if (message.recipient.length > 254 || !/^[a-zA-Z0-9.!#$%&'*+/=?^_~|-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/.test(message.recipient)
    || /[\r\n]/.test(message.subject) || Buffer.byteLength(message.subject, 'utf8') > 120
    || Buffer.byteLength(message.text, 'utf8') + Buffer.byteLength(message.html, 'utf8') > 65536) return 'unconfirmed';
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
      return 'unconfirmed';
    }
    const data: unknown = await response.json();
    return data && typeof data === 'object' && 'messageId' in data && typeof data.messageId === 'string' && data.messageId.trim()
      ? 'accepted' : 'unconfirmed';
  } catch {
    // No provider body, message ID, credentials or recipient in the returned result.
    return 'unconfirmed';
  }
}
