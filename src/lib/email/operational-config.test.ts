import { describe, expect, it } from 'vitest';
import { operationalMailDiagnostic, operationalMailStatus, readOperationalMailConfig } from './operational-config';

const valid = {
  OPERATIONAL_EMAIL_ENABLED: 'true',
  OPERATIONAL_SMTP_HOST: 'smtp.example.test',
  OPERATIONAL_SMTP_PORT: '587',
  OPERATIONAL_SMTP_USER: 'office@example.test',
  OPERATIONAL_SMTP_PASSWORD: 'test-only-secret',
  OPERATIONAL_EMAIL_FROM: 'office@example.test',
};

describe('operational email runtime configuration', () => {
  it('defaults to disabled, even if credentials exist', () => {
    expect(readOperationalMailConfig({})).toEqual({ status: 'disabled' });
    expect(readOperationalMailConfig({ ...valid, OPERATIONAL_EMAIL_ENABLED: 'false' })).toEqual({ status: 'disabled' });
  });

  it('rejects ambiguous activation and missing credentials', () => {
    expect(operationalMailStatus({ ...valid, OPERATIONAL_EMAIL_ENABLED: 'yes' })).toBe('invalid');
    expect(operationalMailStatus({ ...valid, OPERATIONAL_SMTP_PASSWORD: '' })).toBe('incomplete');
  });

  it.each(['25', '2525', '587.0', 'not-a-port'])('rejects unsupported port %s', (port) => {
    expect(operationalMailStatus({ ...valid, OPERATIONAL_SMTP_PORT: port })).toBe('invalid');
  });

  it.each(['https://smtp.example.test', 'smtp.example.test/path', '127.0.0.1'])('rejects invalid SMTP host %s', (host) => {
    expect(operationalMailStatus({ ...valid, OPERATIONAL_SMTP_HOST: host })).toBe('invalid');
  });

  it.each(['a@example.test,b@example.test', 'Name <a@example.test>', 'a@example.test\r\nBcc: b@example.test'])('rejects non-single sender %s', (from) => {
    expect(operationalMailStatus({ ...valid, OPERATIONAL_EMAIL_FROM: from })).toBe('invalid');
  });

  it('rejects invalid reply-to', () => {
    expect(operationalMailStatus({ ...valid, OPERATIONAL_EMAIL_REPLY_TO: 'not-an-address' })).toBe('invalid');
  });

  it('requires STARTTLS on 587 and implicit TLS on 465', () => {
    expect(readOperationalMailConfig(valid)).toMatchObject({ status: 'configured', config: { secure: false, requireTLS: true, port: 587 } });
    expect(readOperationalMailConfig({ ...valid, OPERATIONAL_SMTP_PORT: '465' })).toMatchObject({ status: 'configured', config: { secure: true, requireTLS: false, port: 465 } });
  });

  it('projects only status for the administration UI', () => {
    expect(operationalMailStatus(valid)).toBe('configured');
    expect(JSON.stringify(operationalMailStatus(valid))).not.toContain(valid.OPERATIONAL_SMTP_PASSWORD);
    expect(JSON.stringify(operationalMailStatus(valid))).not.toContain(valid.OPERATIONAL_SMTP_USER);
  });
});

describe('corporate sender diagnostic', () => {
  it('returns only validated sender, reply-to and TLS mode, not SMTP login, host or secret', () => {
    const diagnostic = operationalMailDiagnostic({ ...valid, OPERATIONAL_SMTP_USER: 'private-login', OPERATIONAL_EMAIL_REPLY_TO: 'support@example.test' });
    expect(diagnostic).toEqual({ status: 'configured', provider: 'smtp', issues: [], missing: [], sender: 'office@example.test', replyTo: 'support@example.test', tls: 'STARTTLS 587' });
    expect(JSON.stringify(diagnostic)).not.toMatch(/private-login|test-only-secret|smtp\.example\.test/);
  });
  it('reports missing keys by name without displaying a partially configured address', () => {
    expect(operationalMailDiagnostic({ ...valid, OPERATIONAL_SMTP_PASSWORD: undefined })).toEqual({
      status: 'incomplete', provider: 'smtp', issues: [], missing: ['OPERATIONAL_SMTP_PASSWORD'], sender: null, replyTo: null, tls: null,
    });
  });
  it('rejects SMTP usernames that cannot be represented in curl credentials', () => {
    expect(operationalMailStatus({ ...valid, OPERATIONAL_SMTP_USER: 'login:extra' })).toBe('invalid');
  });
});

describe('Brevo API configuration', () => {
  const brevo = { OPERATIONAL_EMAIL_ENABLED: 'true', OPERATIONAL_EMAIL_PROVIDER: 'brevo', BREVO_API_KEY: 'fake-fixture-key-for-tests', OPERATIONAL_EMAIL_FROM: 'office@example.test' };
  it('requires only the API key and authorized sender', () => {
    expect(readOperationalMailConfig(brevo)).toMatchObject({ status: 'configured', provider: 'brevo' });
    expect(operationalMailDiagnostic(brevo)).toEqual({ status: 'configured', provider: 'brevo', issues: [], missing: [], sender: 'office@example.test', replyTo: null, tls: 'HTTPS (Brevo)' });
    expect(JSON.stringify(operationalMailDiagnostic(brevo))).not.toContain(brevo.BREVO_API_KEY);
  });
  it('rejects SMTP credentials and missing API keys without falling back', () => {
    expect(operationalMailStatus({ ...brevo, BREVO_API_KEY: 'xsmtpsib-fake-fixture-only' })).toBe('invalid');
    expect(operationalMailStatus({ ...valid, ...brevo, BREVO_API_KEY: '' })).toBe('incomplete');
    expect(operationalMailStatus({ ...brevo, OPERATIONAL_EMAIL_PROVIDER: 'unknown' })).toBe('invalid');
  });
});

describe('safe configuration issue details', () => {
  const brevo = { OPERATIONAL_EMAIL_ENABLED: 'true', OPERATIONAL_EMAIL_PROVIDER: 'brevo', BREVO_API_KEY: 'fixture-valid-api-key', OPERATIONAL_EMAIL_FROM: 'office@example.test' };
  it.each([
    ['xsmtpsib-fixture-not-an-api-key', 'brevo_smtp_key'],
    ['eyJhcGlfa2V5fixture-only', 'brevo_mcp_token'],
    ['"fixture-quoted-key"', 'brevo_key_format'],
    ['fixture key with spaces', 'brevo_key_format'],
  ])('reports the credential type without returning its value (%s)', (key, issue) => {
    const diagnostic = operationalMailDiagnostic({ ...brevo, BREVO_API_KEY: key });
    expect(diagnostic).toMatchObject({ status: 'invalid', issues: [issue], sender: null });
    expect(JSON.stringify(diagnostic)).not.toContain(key);
  });
  it('identifies both malformed addresses and keeps them private', () => {
    const diagnostic = operationalMailDiagnostic({ ...brevo, OPERATIONAL_EMAIL_FROM: 'invalid-private-sender', OPERATIONAL_EMAIL_REPLY_TO: 'invalid-private-reply' });
    expect(diagnostic).toMatchObject({ status: 'invalid', issues: ['sender', 'reply_to'] });
    expect(JSON.stringify(diagnostic)).not.toContain('invalid-private');
  });
  it('distinguishes missing credentials, invalid activation and invalid provider', () => {
    expect(operationalMailDiagnostic({ ...brevo, BREVO_API_KEY: '   ' })).toMatchObject({ status: 'incomplete', missing: ['BREVO_API_KEY'] });
    expect(operationalMailDiagnostic({ ...brevo, OPERATIONAL_EMAIL_ENABLED: 'yes' }).issues).toEqual(['activation']);
    expect(operationalMailDiagnostic({ ...brevo, OPERATIONAL_EMAIL_PROVIDER: 'other' }).issues).toEqual(['provider']);
    expect(operationalMailDiagnostic({ ...valid, OPERATIONAL_SMTP_PORT: '25' }).issues).toEqual(['smtp_port']);
  });
});
