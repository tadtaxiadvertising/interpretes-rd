// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createVerifiedDatabasePoolConfig } from '../../../interpreters-api/src/lib/database-tls';

const localUrl = 'postgresql://tester:synthetic-secret@127.0.0.1:5432/ci_db';
const remoteUrl = 'postgresql://tester:synthetic-secret@db.example.test:5432/app';
const ca = '-----BEGIN CERTIFICATE-----\nCI_CERTIFICATE_ONLY\n-----END CERTIFICATE-----';

describe('dedicated backend PostgreSQL connection trust', () => {
  it('uses a bounded pool without TLS only for loopback E2E', () => {
    const loadCa = vi.fn(() => { throw new Error('should not read CA for loopback'); });
    const config = createVerifiedDatabasePoolConfig(localUrl, loadCa);
    expect(config).toMatchObject({
      connectionString: localUrl,
      max: 3,
      ssl: false,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    expect(loadCa).not.toHaveBeenCalled();
  });

  it('requires CA-validated TLS for all remote databases', () => {
    const loadCa = vi.fn(() => ca);
    const config = createVerifiedDatabasePoolConfig(remoteUrl, loadCa);
    expect(config.ssl).toEqual({ rejectUnauthorized: true, ca });
    expect(loadCa).toHaveBeenCalledOnce();
  });

  it.each([
    '', 'https://tester:synthetic-secret@db.example.test/app',
    'postgresql://tester@db.example.test/app',
    'postgresql://tester:synthetic-secret@db.example.test/',
  ])('rejects incomplete or invalid database URLs without leaking credentials', value => {
    expect(() => createVerifiedDatabasePoolConfig(value, () => ca)).toThrow(/DATABASE_URL_/);
  });

  it.each([
    '?sslmode=disable', '?sslmode=require', '?ssl=true', '?sslrootcert=/tmp/ca',
    '?host=another.example', '?hostaddr=203.0.113.42', '?port=443', '?uselibpqcompat=true',
  ])('disallows connection string overrides (%s)', query => {
    expect(() => createVerifiedDatabasePoolConfig(localUrl + query, () => ca))
      .toThrow('DATABASE_URL_OPTIONS_NOT_ALLOWED');
    expect(() => createVerifiedDatabasePoolConfig(remoteUrl + query, () => ca))
      .toThrow('DATABASE_URL_OPTIONS_NOT_ALLOWED');
  });

  it('never falls back to insecure TLS if trusted CA is missing or corrupt', () => {
    expect(() => createVerifiedDatabasePoolConfig(remoteUrl, () => '')).toThrow('DATABASE_TRUST_CA_INVALID');
    expect(() => createVerifiedDatabasePoolConfig(remoteUrl, () => { throw new Error('sensitive path'); }))
      .toThrow('DATABASE_TRUST_CA_MISSING');
  });

  it('packages the trusted CA into the backend runner', () => {
    const dockerfile = readFileSync('Dockerfile.api', 'utf8');
    const source = readFileSync('interpreters-api/src/lib/prisma.ts', 'utf8');
    expect(dockerfile).toContain('COPY --chown=apiuser:nodejs certs/prod-ca-2021.crt ./certs/prod-ca-2021.crt');
    expect(source).toContain('createVerifiedDatabasePoolConfig(');
    expect(source).not.toContain('rejectUnauthorized: false');
  });
});
