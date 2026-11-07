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
});
