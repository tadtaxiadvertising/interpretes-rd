// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createDatabasePoolConfig } from './database-pool-config';

const local = 'postgresql://postgres:local-password@127.0.0.1:5432/isolated?sslmode=disable';
const remote = 'postgresql://postgres.projectref:private-password@region.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=5';
const ca = '-----BEGIN CERTIFICATE-----\nfixture-only\n-----END CERTIFICATE-----';

describe('PostgreSQL runtime TLS boundary', () => {
  it('preserves explicit no-TLS for isolated loopback test PostgreSQL', () => {
    const config = createDatabasePoolConfig(local);
    expect(config.connectionString).toBe(local);
    expect(config.ssl).toBe(false);
    expect(config.max).toBe(5);
    expect(config.connectionTimeoutMillis).toBe(10_000);
  });

  it('fails closed when a remote database has no trusted CA', () => {
    expect(() => createDatabasePoolConfig(remote)).toThrow('bundled Supabase CA PEM certificate is required');
  });

  it('requires certificate verification for remote connections', () => {
    const config = createDatabasePoolConfig(remote, ca);
    expect(config.connectionString).toBe(remote);
    expect(config.ssl).toEqual({ rejectUnauthorized: true, ca });
    expect(config.max).toBe(5);
  });

  it.each([
    '?sslmode=disable', '?sslmode=require', '?sslmode=no-verify',
    '?sslrootcert=/tmp/root.pem', '?sslcert=/tmp/cert.pem',
    '?sslkey=/tmp/key.pem', '?ssl=false', '?uselibpqcompat=true',
  ])('rejects remote connection string TLS override %s', (suffix) => {
    const url = remote.split('?')[0] + suffix;
    expect(() => createDatabasePoolConfig(url, ca)).toThrow('remote TLS options are not allowed');
  });

  it('rejects missing or invalid URLs without returning secrets in errors', () => {
    expect(() => createDatabasePoolConfig(undefined)).toThrow('DATABASE_URL is required');
    for (const url of [
      'postgresql://postgres:private-password@',
      'https://postgres:private-password@remote.example.com/postgres',
    ]) {
      let message = '';
      try { createDatabasePoolConfig(url, ca); } catch (error) { message = (error as Error).message; }
      expect(message).toContain('DATABASE_URL');
      expect(message).not.toContain('private-password');
    }
  });

  it.each([
    '?host=attacker.example.test',
    '?hostaddr=203.0.113.22',
    '?port=6543',
  ])('rejects host/port overrides even when the URL hostname is loopback (%s)', suffix => {
    const base = local.split('?')[0];
    expect(() => createDatabasePoolConfig(base + suffix))
      .toThrow('DATABASE_URL connection target overrides are not allowed');
  });

  it.each([
    '?host=127.0.0.1',
    '?hostaddr=127.0.0.1',
    '?port=5432',
  ])('rejects a remote URL that attempts to change the connection target (%s)', suffix => {
    const base = remote.split('?')[0];
    expect(() => createDatabasePoolConfig(base + suffix, ca))
      .toThrow('DATABASE_URL connection target overrides are not allowed');
  });

  it('keeps legitimate frontend pooler options and CI loopback compatibility', () => {
    expect(createDatabasePoolConfig(remote, ca)).toMatchObject({
      connectionString: remote,
      ssl: { rejectUnauthorized: true, ca },
      max: 5,
    });
    expect(createDatabasePoolConfig(local)).toMatchObject({
      connectionString: local,
      ssl: false,
      max: 5,
    });
  });

  it('does not expose sensitive query parameters in rejected override errors', () => {
    const secret = 'super-secret-query-credential';
    let errorMessage = '';
    try {
      createDatabasePoolConfig(
        local.split('?')[0] + '?host=attacker.example.test&password=' + secret,
      );
    } catch (error) {
      errorMessage = (error as Error).message;
    }
    expect(errorMessage).toContain('connection target overrides are not allowed');
    expect(errorMessage).not.toContain(secret);
  });


});
