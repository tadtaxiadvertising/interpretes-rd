// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createMigrationClientConfig } from './run-migration';

const connectionString =
  'postgresql://postgres.abcdefghijklmnopqrst:fixture-password@aws-1-us-east-1.pooler.supabase.com:5432/postgres';
const caPem =
  '-----BEGIN CERTIFICATE-----\nfixture-only\n-----END CERTIFICATE-----';

describe('production migration connection TLS', () => {
  it('uses the bundled CA and strict certificate verification', () => {
    const config = createMigrationClientConfig(connectionString, caPem);

    expect(config.connectionString).toBe(connectionString);
    expect(config.ssl).toEqual({
      rejectUnauthorized: true,
      ca: caPem,
    });
  });

  it('does not allow remote SSL overrides to downgrade TLS', () => {
    expect(() =>
      createMigrationClientConfig(
        connectionString + '?sslmode=disable',
        caPem,
      ),
    ).toThrow('remote TLS options are not allowed');
  });
});
