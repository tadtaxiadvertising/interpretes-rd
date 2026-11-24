// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { recruitmentSmtpMessage } from './smtp-test';
import { renderRecruitmentEmail } from './recruitment-templates';
import type { OperationalMailConfig } from './operational-config';

const config: OperationalMailConfig = {
  host: 'smtp.example.test', port: 587, secure: false, requireTLS: true,
  user: 'office@example.test', password: 'private-fixture', from: 'office@example.test',
};
const message = { recipient: 'candidate@example.test', ...renderRecruitmentEmail('application_received') };

describe('recruitment SMTP MIME', () => {
  it('encodes both approved text and HTML with one recipient and no secrets', () => {
    const mime = recruitmentSmtpMessage(config, message);
    expect(mime).toContain('To: candidate@example.test\r\n');
    expect(mime).toContain('Content-Type: multipart/alternative; boundary=');
    expect(mime).toContain('Content-Type: text/plain; charset=UTF-8');
    expect(mime).toContain('Content-Type: text/html; charset=UTF-8');
    expect(mime.replace(/\r\n/g, '')).toContain(Buffer.from(message.text).toString('base64'));
    expect(mime.replace(/\r\n/g, '')).toContain(Buffer.from(message.html).toString('base64'));
    expect(mime).not.toContain(config.password);
  });
  it.each(['candidate@example.test\nBcc: other@example.test', 'a@example.test,b@example.test', 'Name <candidate@example.test>'])('rejects invalid recipient %s', recipient => {
    expect(() => recruitmentSmtpMessage(config, { ...message, recipient })).toThrow();
  });
  it('rejects injected subject and oversized content', () => {
    expect(() => recruitmentSmtpMessage(config, { ...message, subject: 'subject\r\nBcc: other@example.test' })).toThrow();
    expect(() => recruitmentSmtpMessage(config, { ...message, html: 'x'.repeat(65537) })).toThrow();
  });
});
