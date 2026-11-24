// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { smtpTestCurlConfig, smtpTestMessage } from './smtp-test';
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
