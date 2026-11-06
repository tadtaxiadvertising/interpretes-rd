import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client, type ClientConfig } from 'pg';
import { normalizeDirectDatabaseUrl } from './normalize-direct-database-url';

const requiredSecrets = ['DIRECT_URL', 'EASYPANEL_WEBHOOK_INTERPRETERS', 'EASYPANEL_WEBHOOK_API'] as const;
type DeploymentEnvironment = Partial<Record<(typeof requiredSecrets)[number], string>>;
interface PreflightClient {
  connect(): Promise<unknown>;
  query(sql: string): Promise<unknown>;
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
    }
    await client.query('ROLLBACK');
  } catch {
    throw new Error('Production preflight: DIRECT_URL connection or schema prerequisite check failed. Verify the production target, credentials, network access and client-directory migration. No deployment was triggered.');
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
