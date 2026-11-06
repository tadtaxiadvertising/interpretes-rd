/**
 * Normalize and validate a PostgreSQL URL used for schema migrations.
 * Allow direct PostgreSQL or Supabase's session pooler on port 5432, which
 * preserves a session for transaction-scoped advisory locks and DDL. GitHub
 * hosted runners are IPv4-only; a Supabase IPv6-only direct endpoint cannot
 * be used there without the optional IPv4 add-on. Never use transaction pooling.
 * Keep this guard shared across preflight and standalone migration invocations.
 * Error messages intentionally contain no URL fragments or credentials.
 */
export class DirectDatabaseUrlError extends Error {}

export function normalizeDirectDatabaseUrl(raw: string | undefined): string {
  const value = raw?.trim();
  if (!value) {
    throw new DirectDatabaseUrlError('DIRECT_URL es obligatorio; DATABASE_URL no es una alternativa para migraciones.');
  }
  if (/\s|[\u0000-\u001f\u007f]/u.test(value)) {
    throw new DirectDatabaseUrlError('DIRECT_URL no puede contener espacios internos ni caracteres de control.');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DirectDatabaseUrlError('DIRECT_URL debe tener un formato de URL válido.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname || !url.username || !url.password ||
      url.pathname.length <= 1 || url.hash || url.hostname.includes('%')) {
    throw new DirectDatabaseUrlError('DIRECT_URL debe ser una URL PostgreSQL completa.');
  }
  // The pg connection-string parser may use these query parameters to override
  // parsed credentials, destination or safety timeouts.
  if (['host', 'port', 'user', 'password', 'query_timeout', 'statement_timeout']
    .some((key) => url.searchParams.has(key))) {
    throw new DirectDatabaseUrlError('DIRECT_URL no puede redefinir el destino, las credenciales ni los límites de conexión.');
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/u, '');
  const sharedSupabasePooler = hostname.endsWith('.pooler.supabase.com');
  // Session pooling uses a project-scoped user. This catches accidentally
  // pasting a direct-connection username into a session-pooler endpoint.
  if (sharedSupabasePooler &&
      (url.port !== '5432' || !/^[a-zA-Z_][a-zA-Z0-9_]*\.[a-z0-9]{20}$/u.test(url.username))) {
    throw new DirectDatabaseUrlError('DIRECT_URL: el pooler de sesión Supabase requiere puerto 5432 y usuario rol.PROJECT_REF.');
  }
  if (url.port === '6543' ||
      url.searchParams.getAll('pgbouncer').some((mode) => mode.toLowerCase() === 'true') ||
      url.searchParams.getAll('pool_mode').some((mode) =>
        ['transaction', 'statement'].includes(mode.toLowerCase()))) {
    throw new DirectDatabaseUrlError('DIRECT_URL debe usar PostgreSQL directo o pooler de sesión (5432), nunca pooler transaccional.');
  }
  return value;
}
