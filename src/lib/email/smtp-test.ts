import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readOperationalMailConfig, type OperationalMailConfig } from './operational-config';

export type MailTestResult = 'disabled' | 'invalid' | 'incomplete' | 'accepted' | 'unconfirmed' | 'rate_limited';

function quote(value: string): string {
  if (Array.from(value).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) throw new Error('Invalid SMTP configuration');
  return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

/** Credentials are supplied exclusively via stdin, never argv or a file. */
export function smtpTestCurlConfig(config: OperationalMailConfig): string {
  if (config.user.includes(':')) throw new Error('Invalid SMTP username');
  return [
    'url = ' + quote((config.secure ? 'smtps://' : 'smtp://') + config.host + ':' + config.port),
    'user = ' + quote(config.user + ':' + config.password),
    'mail-from = ' + quote(config.from),
    'mail-rcpt = ' + quote(config.from),
    '',
  ].join('\n');
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

let nextTestAt = 0;
let busy = false;

/** One explicit test to the configured sender; never a candidate address.
 * Process-local throttling is a convenience, not a distributed rate limit.
 */
export async function sendOperationalMailTest(): Promise<MailTestResult> {
  const result = readOperationalMailConfig(process.env);
  if (result.status !== 'configured') return result.status;
  if (busy || Date.now() < nextTestAt) return 'rate_limited';
  busy = true;
  nextTestAt = Date.now() + 60000;
  let directory: string | undefined;
  try {
    const config = smtpTestCurlConfig(result.config);
    directory = await mkdtemp(join(tmpdir(), 'ird-mail-test-'));
    const file = join(directory, 'message.eml');
    await writeFile(file, smtpTestMessage(result.config), { mode: 0o600, flag: 'wx' });
    return await runCurl(file, config) ? 'accepted' : 'unconfirmed';
  } catch {
    return 'unconfirmed';
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
    busy = false;
  }
}
