/**
 * Only for disposable CI databases. Do not reuse this guard for production.
 * Never give pg an untrusted connectionString after validating its authority:
 * query parameters can override the host, database, user and other options.
 * @param {Readonly<Record<string, string | undefined>>} env
 */
export function readRoleplayCreationCiTarget(env) {
  const raw = env.DATABASE_URL;
  if (!raw || env.CI !== 'true' || env.NODE_ENV === 'production') {
    throw new Error('Disposable PostgreSQL CI required.');
  }
  try {
    const url = new URL(raw);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
        !['localhost', '127.0.0.1'].includes(url.hostname) ||
        url.pathname !== '/interpreters_e2e' || url.username !== 'postgres' ||
        url.port !== '5432' || url.hash || !url.password) {
      throw new Error();
    }
    const allowed = new Map([['schema', 'public'], ['sslmode', 'disable']]);
    const seen = new Set();
    for (const [key, value] of url.searchParams) {
      if (seen.has(key) || !allowed.has(key) || allowed.get(key) !== value) throw new Error();
      seen.add(key);
    }
    const password = decodeURIComponent(url.password);
    if (!password || password.includes('\0')) throw new Error();
    return {
      host: '127.0.0.1', port: 5432, user: 'postgres', password,
      database: 'interpreters_e2e', ssl: false,
      connectionTimeoutMillis: 5000, statement_timeout: 15000, query_timeout: 20000,
    };
  } catch {
    // Never disclose an input URI or credentials, even for malformed URLs.
    throw new Error('Non-isolated PostgreSQL target rejected.');
  }
}
