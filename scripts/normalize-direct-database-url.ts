/**
 * Normalize and validate a PostgreSQL URL used for schema migrations.
 * Keep this guard shared between deployment preflight and the migration runner,
 * so standalone invocations cannot bypass the direct-connection requirement.
 * Error messages intentionally contain no URL fragments or credentials.
 */
export function normalizeDirectDatabaseUrl(raw: string | undefined): string {
  const value = raw?.trim();
  if (!value) {
    throw new Error('DIRECT_URL es obligatorio; DATABASE_URL no es una alternativa para migraciones.');
  }
  if (/\s|[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error('DIRECT_URL no puede contener espacios internos ni caracteres de control.');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('DIRECT_URL debe tener un formato de URL válido.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname || !url.username || !url.password ||
      url.pathname.length <= 1 || url.hash || url.hostname.includes('%')) {
    throw new Error('DIRECT_URL debe ser una URL PostgreSQL completa.');
  }
  // The pg connection-string parser may use these query parameters to override
  // parsed credentials, destination or safety timeouts.
  if (['host', 'port', 'user', 'password', 'query_timeout', 'statement_timeout']
    .some((key) => url.searchParams.has(key))) {
    throw new Error('DIRECT_URL no puede redefinir el destino, las credenciales ni los límites de conexión.');
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/u, '');
  if (url.port === '6543' ||
      hostname.endsWith('.pooler.supabase.com') ||
      url.searchParams.getAll('pgbouncer').some((mode) => mode.toLowerCase() === 'true') ||
      url.searchParams.getAll('pool_mode').some((mode) =>
        ['transaction', 'statement'].includes(mode.toLowerCase()))) {
    throw new Error('DIRECT_URL debe usar una conexión PostgreSQL directa, no un pooler.');
  }
  return value;
}
