import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client, type ClientConfig } from 'pg';
import { normalizeDirectDatabaseUrl } from './normalize-direct-database-url';

const requiredSecrets = ['DIRECT_URL', 'EASYPANEL_WEBHOOK_INTERPRETERS', 'EASYPANEL_WEBHOOK_API'] as const;
type DeploymentEnvironment = Partial<Record<(typeof requiredSecrets)[number], string>>;
interface PreflightClient {
  connect(): Promise<unknown>;
  query(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<unknown>;
}

// Report only fixed names/messages. URL parsers and database errors can contain credentials.
export function validateDeploymentSecrets(env: DeploymentEnvironment): string {
  const missing = requiredSecrets.filter((name) => !env[name]?.trim());
  if (missing.length) {
    throw new Error(`Production preflight: missing secrets: ${missing.join(', ')}. Configure GitHub Settings > Environments > production > Environment secrets.`);
  }

  let connectionString = '';
  for (const name of requiredSecrets) {
    const value = env[name]!.trim();
    if (name === 'DIRECT_URL') {
      try {
        connectionString = normalizeDirectDatabaseUrl(value);
      } catch (error) {
        // Never include the original URL (which may contain a password).
        throw new Error(`Production preflight: ${(error as Error).message}`);
      }
      continue;
    }

    let url: URL;
    try {
      if (/\s|[\u0000-\u001f\u007f]/u.test(value)) throw new Error();
      url = new URL(value);
    } catch {
      throw new Error(`Production preflight: ${name} must be a valid URL without whitespace or control characters.`);
    }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
      throw new Error(`Production preflight: ${name} must use HTTP or HTTPS.`);
    }
  }
  return connectionString;
}

const safeConnectionDiagnostics: Record<string, string> = {
  ENOTFOUND: 'DNS no pudo resolver el host PostgreSQL.',
  EAI_AGAIN: 'La resolución DNS de PostgreSQL falló temporalmente.',
  ETIMEDOUT: 'La conexión a PostgreSQL agotó el tiempo de espera.',
  ECONNREFUSED: 'El servidor rechazó la conexión TCP.',
  ECONNRESET: 'La conexión TCP se cerró inesperadamente.',
  ENETUNREACH: 'La red no tiene ruta hacia el servidor PostgreSQL.',
  EHOSTUNREACH: 'El host PostgreSQL no es alcanzable desde GitHub Actions.',
  SELF_SIGNED_CERT_IN_CHAIN: 'La cadena TLS contiene un certificado autofirmado no confiable.',
  CERT_HAS_EXPIRED: 'El certificado TLS del servidor ha expirado.',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'No se pudo verificar la cadena del certificado TLS.',
  '28P01': 'PostgreSQL rechazó la autenticación. Verifica usuario y contraseña.',
  '3D000': 'La base de datos indicada no existe en el servidor.',
  '28000': 'PostgreSQL rechazó la autorización del usuario.',
  '08001': 'No se pudo establecer la conexión SQL con el servidor.',
  '08006': 'La conexión SQL falló durante el establecimiento o uso.',
};

function safeConnectionDiagnostic(error: unknown): string | undefined {
  // Driver and framework wrappers may expose a primitive message or a nested cause.
  // Only fixed, allowlisted descriptions and class names can leave this process.
  const queue: unknown[] = [error];
  const visited = new Set<object>();
  const messageDiagnostics: Array<[RegExp, string]> = [
    [/self[- ]signed certificate in certificate chain/i, safeConnectionDiagnostics.SELF_SIGNED_CERT_IN_CHAIN],
    [/certificate has expired|expired certificate/i, safeConnectionDiagnostics.CERT_HAS_EXPIRED],
    [/unable to verify (?:the )?(?:first )?certificate|unable to verify leaf signature/i, safeConnectionDiagnostics.UNABLE_TO_VERIFY_LEAF_SIGNATURE],
    [/getaddrinfo .*ENOTFOUND|\bENOTFOUND\b/i, safeConnectionDiagnostics.ENOTFOUND],
    [/\bEAI_AGAIN\b/i, safeConnectionDiagnostics.EAI_AGAIN],
    [/\bETIMEDOUT\b|connection timed out|timeout expired/i, safeConnectionDiagnostics.ETIMEDOUT],
    [/\bECONNREFUSED\b/i, safeConnectionDiagnostics.ECONNREFUSED],
    [/\bECONNRESET\b/i, safeConnectionDiagnostics.ECONNRESET],
    [/password authentication failed|\b28P01\b/i, safeConnectionDiagnostics['28P01']],
    [/database .* does not exist|\b3D000\b/i, safeConnectionDiagnostics['3D000']],
    [/no pg_hba\\.conf entry|pg_hba\\.conf/i, 'El servidor PostgreSQL rechazó el origen de la conexión por su política de acceso.'],
    [/connection terminated unexpectedly|server closed the connection unexpectedly/i, 'El servidor PostgreSQL cerró la conexión durante el establecimiento.'],
    [/server does not support ssl|ssl is not enabled on the server/i, 'El servidor PostgreSQL no acepta la negociación TLS solicitada.'],
    [/client password must be a string|SASL: SCRAM/i, 'La autenticación SCRAM no recibió una contraseña válida.'],
    [/tenant or user not found|invalid tenant/i, 'El pooler no reconoce el usuario o proyecto configurado.'],
    [/too many connections|remaining connection slots/i, 'PostgreSQL rechazó la conexión porque alcanzó su límite de conexiones.'],
    [/self[- ]signed|certificate|\bTLS\b|\bSSL\b/i, 'Falló la validación o negociación del certificado TLS con PostgreSQL.'],
    [/getaddrinfo|name or service not known|temporary failure in name resolution/i, 'Falló la resolución DNS del servidor PostgreSQL.'],
    [/connect .* timed out|connection timeout|timeout expired/i, safeConnectionDiagnostics.ETIMEDOUT],
  ];
  const safeClassNames = new Set([
    'Error', 'AggregateError', 'DatabaseError', 'ConnectionError',
    'TimeoutError', 'ErrorEvent', 'PostgresError',
  ]);
  let safeClassName = 'Error';

  while (queue.length) {
    const current = queue.shift();
    if (typeof current === 'string') {
      for (const [pattern, diagnostic] of messageDiagnostics) {
        if (pattern.test(current)) return diagnostic;
      }
      continue;
    }
    if (!current || typeof current !== 'object' || visited.has(current)) continue;
    visited.add(current);
    const candidate = current as Record<string, unknown>;
    if (typeof candidate.name === 'string' && safeClassNames.has(candidate.name)) {
      safeClassName = candidate.name;
    }
    if (typeof candidate.code === 'string') {
      if (safeConnectionDiagnostics[candidate.code]) {
        return safeConnectionDiagnostics[candidate.code];
      }
      if (candidate.code === 'ERR_TLS_CERT_ALTNAME_INVALID') {
        return 'El certificado TLS no coincide con el nombre del servidor.';
      }
      if (candidate.code.startsWith('ERR_TLS_') || candidate.code.startsWith('ERR_SSL_')) {
        return 'Falló la negociación o validación TLS con PostgreSQL.';
      }
    }
    if (typeof candidate.message === 'string') {
      for (const [pattern, diagnostic] of messageDiagnostics) {
        if (pattern.test(candidate.message)) return diagnostic;
      }
    }
    for (const key of ['cause', 'originalError', 'parent', 'error']) {
      if (candidate[key] !== undefined) queue.push(candidate[key]);
    }
    if (Array.isArray(candidate.errors)) queue.push(...candidate.errors.slice(0, 8));
  }

  // Keep the output actionable without ever printing arbitrary error text, codes, or URLs.
  return `El controlador PostgreSQL devolvió un error no clasificado (tipo seguro: ${safeClassName}). Revisar endpoint, credenciales, TLS y conectividad.`;
}

function createPreflightClient(config: ClientConfig): PreflightClient {
  const client = new Client(config);
  // Query/connect promises report failures below; never print raw idle socket errors.
  client.on('error', () => undefined);
  return client;
}

export async function runDeploymentPreflight(
  env: DeploymentEnvironment,
  createClient: (config: ClientConfig) => PreflightClient = createPreflightClient,
  verifySchema = false,
): Promise<void> {
  // All three secrets must pass before even constructing a database client.
  const connectionString = validateDeploymentSecrets(env);
  let client: PreflightClient | undefined;
  try {
    client = createClient({
      connectionString,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 10_000,
      query_timeout: 10_000,
      application_name: 'interpreters-deployment-preflight',
    });
    await client.connect();
    await client.query('BEGIN READ ONLY');
    // The first preflight must run before migrations, so it checks connectivity only.
    // The schema verification mode runs after the additive migrations have completed.
    await client.query('SELECT 1');
    if (verifySchema) {
      await client.query('SELECT id, client_id, name FROM public.accounts LIMIT 0');
      await client.query('SELECT id FROM public.clients LIMIT 0');
      // A table/column-only check can pass after a partial schema change.
      // Confirm the client-scoped uniqueness, FK, RLS, and removal of the
      // old global uniqueness before the deployment webhooks can run.
      const integrity = await client.query(`
        SELECT
          EXISTS (
            SELECT 1 FROM pg_index idx
            WHERE idx.indexrelid = to_regclass('public.accounts_client_id_name_key')
              AND idx.indrelid = 'public.accounts'::regclass
              AND idx.indisunique AND idx.indisvalid AND idx.indisready
              AND idx.indnkeyatts = 2
              AND idx.indkey[0] = (
                SELECT attnum FROM pg_attribute
                WHERE attrelid = 'public.accounts'::regclass AND attname = 'client_id'
              )
              AND idx.indkey[1] = (
                SELECT attnum FROM pg_attribute
                WHERE attrelid = 'public.accounts'::regclass AND attname = 'name'
              )
          ) AS account_unique,
          to_regclass('public.accounts_name_key') IS NULL AS legacy_unique_absent,
          EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conrelid = 'public.accounts'::regclass
              AND confrelid = 'public.clients'::regclass
              AND conname = 'accounts_client_id_fkey'
              AND contype = 'f' AND convalidated
              AND confdeltype = 'n' AND confupdtype = 'c'
          ) AS client_fk,
          (SELECT relrowsecurity FROM pg_class
           WHERE oid = 'public.clients'::regclass) AS client_rls
      `);
      const status = integrity.rows[0];
      if (!status || !['account_unique', 'legacy_unique_absent', 'client_fk', 'client_rls']
        .every((key) => status[key] === true)) {
        throw new Error('Client-directory database constraints are incomplete.');
      }
    }
    await client.query('ROLLBACK');
  } catch (error) {
    const diagnostic = safeConnectionDiagnostic(error);
    const suffix = diagnostic ? ` Diagnostic: ${diagnostic}` : '';
    throw new Error(`Production preflight: DIRECT_URL connection or schema prerequisite check failed. Verify the production target, credentials, network access and client-directory migration. No deployment was triggered.${suffix}`);
  } finally {
    // Closing also rolls back a failed read-only transaction.
    await client?.end().catch(() => undefined);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runDeploymentPreflight(process.env, undefined, process.argv.includes('--verify-schema')).then(() => {
    console.log('Production preflight passed: required secrets and read-only database prerequisites verified.');
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Production preflight failed.');
    process.exitCode = 1;
  });
}
