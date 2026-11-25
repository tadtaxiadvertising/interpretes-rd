import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readOperationalMailConfig, type OperationalMailConfig } from './operational-config';

import { sendBrevoEmail, sendBrevoEmailDetailed, type BrevoFailure } from './brevo-transport';

import { sendResendEmail, type ResendFailure } from './resend-transport';

export type MailTestResult = 'disabled' | 'invalid' | 'incomplete' | 'accepted' | 'unconfirmed' | 'rate_limited' | BrevoFailure | ResendFailure;

function quote(value: string): string {
  if (Array.from(value).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) throw new Error('Invalid SMTP configuration');
  return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

/** Credentials are supplied exclusively via stdin, never argv or a file. */
function smtpCurlConfig(config: OperationalMailConfig, recipient: string): string {
  if (config.user.includes(':')) throw new Error('Invalid SMTP username');
  return [
    'url = ' + quote((config.secure ? 'smtps://' : 'smtp://') + config.host + ':' + config.port),
    'user = ' + quote(config.user + ':' + config.password),
    'mail-from = ' + quote(config.from),
    'mail-rcpt = ' + quote(recipient),
    '',
  ].join('\n');
}

export function smtpTestCurlConfig(config: OperationalMailConfig): string {
  return smtpCurlConfig(config, config.from);
}

function encodedHeader(value: string): string {
  return '=?UTF-8?B?' + Buffer.from(value, 'utf8').toString('base64') + '?=';
}

export function smtpTestMessage(config: OperationalMailConfig, now = new Date(), id = randomUUID()): string {
  const body = Buffer.from('Este es un correo de prueba de Intérpretes RD. Si lo recibiste, verifica el remitente y las cabeceras de autenticación. No contiene datos de postulantes.', 'utf8').toString('base64').match(/.{1,76}/g)?.join('\r\n') ?? '';
  return [
    'From: ' + encodedHeader('Intérpretes RD') + ' <' + config.from + '>',
    'To: ' + config.from,
    ...(config.replyTo ? ['Reply-To: ' + config.replyTo] : []),
    'Subject: ' + encodedHeader('Prueba de correo | Intérpretes RD'),
    'Date: ' + now.toUTCString(),
    'Message-ID: <' + id + '@' + config.from.split('@')[1] + '>',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '', body, '',
  ].join('\r\n');
}

/** No shell, no curlrc, no proxies, required TLS and bounded execution. */
function runCurl(file: string, privateConfig: string): Promise<boolean> {
  return new Promise(resolve => {
    const child = spawn('curl', [
      '-q', '--config', '-', '--proto', '=smtp,smtps', '--noproxy', '*',
      '--ssl-reqd', '--connect-timeout', '8', '--max-time', '20',
      '--silent', '--upload-file', file,
    ], { shell: false, stdio: ['pipe', 'ignore', 'ignore'], env: { PATH: '/usr/local/bin:/usr/bin:/bin', NODE_ENV: 'production' } });
    const timer = setTimeout(() => child.kill('SIGKILL'), 25000);
    child.once('error', () => { clearTimeout(timer); resolve(false); });
    child.once('close', code => { clearTimeout(timer); resolve(code === 0); });
    child.stdin.on('error', () => { /* close reports unconfirmed */ });
    child.stdin.end(privateConfig);
  });
}

type RecruitmentMessage = { recipient: string; subject: string; text: string; html: string };

function singleMailbox(value: string): boolean {
  return value === value.trim() && value.length <= 254
    && /^[a-zA-Z0-9.!#$%&'*+/=?^_~|-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/.test(value);
}

function encodedBody(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64').match(/.{1,76}/g)?.join('\r\n') ?? '';
}

/** Multipart alternative contains only the approved template and one recipient. */
export function recruitmentSmtpMessage(config: OperationalMailConfig, message: RecruitmentMessage, now = new Date()): string {
  if (!singleMailbox(message.recipient) || Buffer.byteLength(message.subject, 'utf8') > 120
    || Buffer.byteLength(message.text, 'utf8') + Buffer.byteLength(message.html, 'utf8') > 65536
    || /[\r\n]/.test(message.subject)) throw new Error('Invalid recruitment message');
  const id = randomUUID();
  const boundary = 'ird-' + id;
  return [
    'From: ' + encodedHeader('Intérpretes RD') + ' <' + config.from + '>',
    'To: ' + message.recipient,
    ...(config.replyTo ? ['Reply-To: ' + config.replyTo] : []),
    'Subject: ' + encodedHeader(message.subject),
    'Date: ' + now.toUTCString(),
    'Message-ID: <' + id + '@' + config.from.split('@')[1] + '>',
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="' + boundary + '"',
    '',
    '--' + boundary, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64',
    '', encodedBody(message.text), '',
    '--' + boundary, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64',
    '', encodedBody(message.html), '',
    '--' + boundary + '--', '',
  ].join('\r\n');
}

async function sendMime(config: OperationalMailConfig, recipient: string, mime: string): Promise<'accepted' | 'unconfirmed'> {
  let directory: string | undefined;
  try {
    const privateConfig = smtpCurlConfig(config, recipient);
    directory = await mkdtemp(join(tmpdir(), 'ird-mail-test-'));
    const file = join(directory, 'message.eml');
    await writeFile(file, mime, { mode: 0o600, flag: 'wx' });
    return await runCurl(file, privateConfig) ? 'accepted' : 'unconfirmed';
  } catch {
    return 'unconfirmed';
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

/** Internal transport. No client action, no retries, no scheduling. */
export async function sendRecruitmentSmtp(message: RecruitmentMessage): Promise<'accepted' | 'unconfirmed'> {
  if (process.env.OPERATIONAL_EMAIL_DISPATCH_ENABLED !== 'true' || process.env.EMAIL_PROVIDER_SOURCE === 'vault') return 'unconfirmed';
  const result = readOperationalMailConfig(process.env);
  if (result.status !== 'configured') return 'unconfirmed';
  try {
    if (result.provider === 'brevo') return await sendBrevoEmail(result.config, message);
    if (result.provider === 'resend') return await sendResendEmail(result.config, message) === 'accepted' ? 'accepted' : 'unconfirmed';
    return await sendMime(result.config, message.recipient, recruitmentSmtpMessage(result.config, message));
  } catch {
    return 'unconfirmed';
  }
}

let nextTestAt = 0;
let busy = false;

/** One explicit test to the configured sender; never a candidate address.
 * Process-local throttling is a convenience, not a distributed rate limit.
 */
export async function sendOperationalMailTest(): Promise<MailTestResult> {
  if (process.env.EMAIL_PROVIDER_SOURCE === 'vault') return 'disabled';
  const result = readOperationalMailConfig(process.env);
  if (result.status !== 'configured') return result.status;
  if (busy || Date.now() < nextTestAt) return 'rate_limited';
  busy = true;
  nextTestAt = Date.now() + 60000;
  try {
    if (result.provider === 'resend') return await sendResendEmail(result.config, {
      recipient: result.config.from,
      subject: 'Prueba de correo | Intérpretes RD',
      text: 'Este es un correo de prueba de Intérpretes RD. No contiene datos de postulantes.',
      html: '<p>Este es un correo de prueba de Intérpretes RD.</p><p>No contiene datos de postulantes.</p>',
    });
    if (result.provider === 'brevo') return await sendBrevoEmailDetailed(result.config, {
      recipient: result.config.from,
      subject: 'Prueba de correo | Intérpretes RD',
      text: 'Este es un correo de prueba de Intérpretes RD. No contiene datos de postulantes.',
      html: '<p>Este es un correo de prueba de Intérpretes RD.</p><p>No contiene datos de postulantes.</p>',
    });
    return await sendMime(result.config, result.config.from, smtpTestMessage(result.config));
  } catch {
    return 'unconfirmed';
  } finally {
    busy = false;
  }
}

/** Internal only: caller supplies a validated fixed-host SMTP profile and committed quota. */
export async function sendReservedSmtpProfile(config: OperationalMailConfig, message: RecruitmentMessage): Promise<'accepted' | 'unconfirmed'> {
  try { return await sendMime(config, message.recipient, recruitmentSmtpMessage(config, message)); }
  catch { return 'unconfirmed'; }
}
