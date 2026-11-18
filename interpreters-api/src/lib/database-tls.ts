import type { PoolConfig } from 'pg';

/**
 * Enforce the same trust boundary as the frontend: local CI databases do not
 * require TLS, but remote PostgreSQL must present a certificate chained to
 * the bundled production CA. Never rely on libpq sslmode=require, which
 * can encrypt without authenticating the peer.
 */
export function createVerifiedDatabasePoolConfig(
  rawUrl: string | undefined,
  loadTrustedCa: () => string,
): PoolConfig {
  if (!rawUrl?.trim()) throw new Error('DATABASE_URL_MISSING');
  let url: URL;
  try { url = new URL(rawUrl.trim()); }
  catch { throw new Error('DATABASE_URL_INVALID'); }

  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname || !url.username || !url.password ||
      !url.pathname || url.pathname === '/') {
    throw new Error('DATABASE_URL_INVALID');
  }

  // node-postgres can read connection-string options that silently supersede
  // PoolConfig.ssl, including query options that redirect a loopback host.
  const forbidden = [
    'sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'ssl',
    'uselibpqcompat', 'host', 'hostaddr', 'port',
  ];
  if (forbidden.some(key => url.searchParams.has(key))) {
    throw new Error('DATABASE_URL_OPTIONS_NOT_ALLOWED');
  }
  const isLocal = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(
    url.hostname.toLowerCase(),
  );
  let ssl: PoolConfig['ssl'] = false;
  if (!isLocal) {
    let ca = '';
    try { ca = loadTrustedCa().trim(); }
    catch { throw new Error('DATABASE_TRUST_CA_MISSING'); }
    if (!ca.includes('-----BEGIN CERTIFICATE-----') ||
        !ca.includes('-----END CERTIFICATE-----')) {
      throw new Error('DATABASE_TRUST_CA_INVALID');
    }
    ssl = { rejectUnauthorized: true, ca };
  }
  return {
    connectionString: rawUrl.trim(),
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl,
  };
}
