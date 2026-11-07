import type { PoolConfig } from 'pg';

/**
 * Runtime database connections must use authenticated TLS outside loopback.
 * The trusted CA is supplied by the application image as a PEM file, avoiding
 * fragile multiline/Base64 environment-variable transport in deployment panels.
 *
 * node-postgres overrides the supplied SSL object when a connection string
 * includes sslmode / sslrootcert / sslcert / sslkey. Reject ambiguous remote
 * URLs instead of silently allowing a connection-string downgrade.
 */
export function createDatabasePoolConfig(
  rawConnectionString: string | undefined,
  caPem?: string,
): PoolConfig {
  if (!rawConnectionString?.trim()) {
    throw new Error('DATABASE_URL is required for database access.');
  }

  let url: URL;
  try {
    url = new URL(rawConnectionString.trim());
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL.');
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname || !url.username || !url.pathname || url.pathname === '/') {
    throw new Error('DATABASE_URL must be a complete PostgreSQL URL.');
  }

  const hostname = url.hostname.toLowerCase();
  const isLoopbackDatabase = [
    'localhost', '127.0.0.1', '::1', '[::1]',
  ].includes(hostname);

  if (!isLoopbackDatabase) {
    const overrides = ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'ssl', 'uselibpqcompat'];
    if (overrides.some((key) => url.searchParams.has(key))) {
      throw new Error(
        'DATABASE_URL remote TLS options are not allowed. TLS verification is configured by the application.',
      );
    }
  }

  const configuredCa = caPem?.trim();
  if (!isLoopbackDatabase &&
      (!configuredCa ||
       !configuredCa.includes('-----BEGIN CERTIFICATE-----') ||
       !configuredCa.includes('-----END CERTIFICATE-----'))) {
    throw new Error('A valid bundled Supabase CA PEM certificate is required for remote database connections.');
  }

  return {
    connectionString: rawConnectionString.trim(),
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: isLoopbackDatabase
      ? false
      : { rejectUnauthorized: true, ca: configuredCa },
    allowExitOnIdle: true,
  };
}
