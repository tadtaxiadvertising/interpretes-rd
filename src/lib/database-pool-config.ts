import type { PoolConfig } from 'pg';

/**
 * Runtime database connections must use authenticated TLS outside loopback.
 * Keep the policy separate from the lazy Prisma singleton so it can be
 * tested without constructing a pool or opening any network connection.
 *
 * node-postgres overrides the supplied SSL object when a connection string
 * includes sslmode / sslrootcert / sslcert / sslkey. Reject ambiguous remote
 * URLs instead of silently allowing a connection-string downgrade.
 */
export function createDatabasePoolConfig(
  rawConnectionString: string | undefined,
  caPem?: string,
  caPemBase64?: string,
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
        'DATABASE_URL remote TLS options are not allowed. Configure verified TLS via DATABASE_TLS_CA_PEM or DATABASE_TLS_CA_PEM_BASE64 instead.',
      );
    }
  }

  let configuredCa = caPem?.trim();
  if (caPemBase64?.trim()) {
    const encodedCa = caPemBase64.trim();
    const decodedCa = Buffer.from(encodedCa, 'base64');
    const canonicalBase64 = decodedCa.toString('base64').replace(/=+$/, '');
    if (canonicalBase64 !== encodedCa.replace(/=+$/, '')) {
      throw new Error('DATABASE_TLS_CA_PEM_BASE64 must contain valid base64-encoded PEM data.');
    }
    configuredCa = decodedCa.toString('utf8').trim();
  }

  if (configuredCa &&
      (!configuredCa.includes('-----BEGIN CERTIFICATE-----') ||
       !configuredCa.includes('-----END CERTIFICATE-----'))) {
    throw new Error('DATABASE_TLS_CA_PEM must contain a complete PEM certificate.');
  }

  return {
    connectionString: rawConnectionString.trim(),
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Loopback test databases may use clear-text connections. Every remote
    // database must use authenticated TLS. A base64 option is available for
    // deployment panels that do not preserve multiline environment values.
    // Never silently accept an untrusted certificate in production.
    ssl: isLoopbackDatabase
      ? false
      : configuredCa
        ? { rejectUnauthorized: true, ca: configuredCa }
        : { rejectUnauthorized: true },
    allowExitOnIdle: true,
  };
}
