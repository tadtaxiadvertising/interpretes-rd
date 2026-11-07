// @vitest-environment node
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { runDeploymentPreflight, validateDeploymentSecrets } from '../../scripts/deployment-preflight';
import { normalizeDirectDatabaseUrl } from '../../scripts/normalize-direct-database-url';

const validEnv = {
  DIRECT_URL: 'postgresql://test:private-password@127.0.0.1:5432/isolated_test',
  EASYPANEL_WEBHOOK_INTERPRETERS: 'https://example.com/private-frontend-token',
  EASYPANEL_WEBHOOK_API: 'https://example.com/private-backend-token',
};

function fakeConnection() {
  const client = {
    connect: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue({ rows: [{ account_unique: true, legacy_unique_absent: true, client_fk: true, client_rls: true }] }),
    end: vi.fn().mockResolvedValue(undefined),
  };
  return { client, createClient: vi.fn().mockReturnValue(client) };
}

describe('deployment credential boundary', () => {
  it.each(Object.keys(validEnv) as (keyof typeof validEnv)[])('blocks missing %s before any connection', async (name) => {
    const { createClient } = fakeConnection();
    await expect(runDeploymentPreflight({ ...validEnv, [name]: ' \t' }, createClient)).rejects.toThrow(name);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('reports all missing names and never falls back to DATABASE_URL', () => {
    expect(() => validateDeploymentSecrets({})).toThrow('DIRECT_URL, EASYPANEL_WEBHOOK_INTERPRETERS, EASYPANEL_WEBHOOK_API');
  });

  it('fails the CLI without falling back to DATABASE_URL or exposing credentials', () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/deployment-preflight.ts'], {
      env: { ...process.env, ...validEnv, DATABASE_URL: validEnv.DIRECT_URL, DIRECT_URL: '' },
      encoding: 'utf8',
      timeout: 10_000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('missing secrets: DIRECT_URL');
    expect(result.stdout + result.stderr).not.toMatch(/private-password|private-frontend-token|private-backend-token/);
  });

  it.each([
    ['DIRECT_URL', 'https://example.com/private-password'],
    ['DIRECT_URL', 'postgresql://test@localhost/db'],
    ['DIRECT_URL', 'postgresql://test:private-password@localhost/'],
    ['DIRECT_URL', 'postgresql://test:private-password@localhost:6543/db'],
    ['DIRECT_URL', 'postgresql://test:private-password@region.pooler.supabase.com:5432/db'],
    ['DIRECT_URL', 'postgresql://test:private-password@REGION.POOLER.SUPABASE.COM:5432/db'],
    ['DIRECT_URL', 'postgresql://test:private-password@region.pooler.supabase.com.:5432/db'],
    ['DIRECT_URL', 'postgresql://test:private-password@region%2epooler%2esupabase%2ecom:5432/db'],
    ['DIRECT_URL', 'postgresql://test:private-password@region.%70ooler.supabase.com:5432/db'],
    ['DIRECT_URL', `${validEnv.DIRECT_URL}?host=region.pooler.supabase.com&port=6543`],
    ['DIRECT_URL', `${validEnv.DIRECT_URL}?port=6543`],
    ['DIRECT_URL', `${validEnv.DIRECT_URL}?query_timeout=3600000`],
    ['DIRECT_URL', `${validEnv.DIRECT_URL}?statement_timeout=3600000`],
    ['DIRECT_URL', `${validEnv.DIRECT_URL}?pgbouncer=true`],
    ['DIRECT_URL', `${validEnv.DIRECT_URL}?pgbouncer=false&pgbouncer=true`],
    ['DIRECT_URL', `${validEnv.DIRECT_URL}?pool_mode=transaction`],
    ['EASYPANEL_WEBHOOK_API', 'file:///private-backend-token'],
    ['EASYPANEL_WEBHOOK_INTERPRETERS', 'private-frontend-token'],
    ['EASYPANEL_WEBHOOK_API', 'https://example.com/token with space'],
  ])('blocks invalid %s without connecting or echoing values', async (name, value) => {
    const { createClient } = fakeConnection();
    let message = '';
    try {
      await runDeploymentPreflight({ ...validEnv, [name]: value }, createClient);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(`Production preflight: ${name}`);
    expect(message).not.toMatch(/private-password|private-frontend-token|private-backend-token/);
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each([
    ['protocol', 'https://tester:private-password@localhost:5432/testdb', 'protocolo PostgreSQL'],
    ['user', 'postgresql://:private-password@localhost:5432/testdb', 'falta el usuario'],
    ['password', 'postgresql://tester@localhost:5432/testdb', 'falta la contraseña'],
    ['database', 'postgresql://tester:private-password@localhost:5432/', 'falta el nombre de la base de datos'],
    ['fragment', 'postgresql://tester:private-password@localhost:5432/testdb#private-fragment', 'fragmento #'],
  ])('identifies the missing DIRECT_URL %s without exposing its input', (_field, url, expectedMessage) => {
    expect(() => validateDeploymentSecrets({ ...validEnv, DIRECT_URL: url }))
      .toThrow('Production preflight: DIRECT_URL');
    let message = '';
    try {
      validateDeploymentSecrets({ ...validEnv, DIRECT_URL: url });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(expectedMessage);
    expect(message).not.toContain('private-password');
    expect(message).not.toContain('private-fragment');
    expect(message).not.toContain('localhost');
  });

  it('accepts correctly percent-encoded reserved password characters without logging them', () => {
    const encoded = 'postgresql://tester:private%23password%40value@localhost:5432/testdb';
    expect(normalizeDirectDatabaseUrl(encoded)).toBe(encoded);
  });

  it('trims surrounding secret whitespace without weakening internal URL validation', () => {
    expect(validateDeploymentSecrets({
      ...validEnv,
      DIRECT_URL: `\r\n  ${validEnv.DIRECT_URL}  \r\n`,
    })).toBe(validEnv.DIRECT_URL);
  });

  it('uses the bundled Supabase CA with strict TLS for remote production connections', async () => {
    const { client, createClient } = fakeConnection();
    const remoteEnv = {
      ...validEnv,
      DIRECT_URL: 'postgresql://postgres.projectref:private-password@aws-1-us-east-1.pooler.supabase.com:5432/postgres',
    };
    await runDeploymentPreflight(remoteEnv, createClient);
    const config = createClient.mock.calls[0][0];
    expect(config.ssl).toEqual(expect.objectContaining({ rejectUnauthorized: true }));
    const tls = config.ssl as { rejectUnauthorized: boolean; ca: string };
    expect(tls.ca).toContain('-----BEGIN CERTIFICATE-----');
    expect(config.connectionString).toBe(remoteEnv.DIRECT_URL);
    expect(client.end).toHaveBeenCalledOnce();
  });

  it('checks connectivity before migrations without requiring the new schema', async () => {
    const { client, createClient } = fakeConnection();
    await runDeploymentPreflight(validEnv, createClient);
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN READ ONLY',
      'SELECT 1',
      'ROLLBACK',
    ]);
    expect(client.end).toHaveBeenCalledOnce();
  });

  it('uses bounded read-only schema queries after migrations, then closes the connection', async () => {
    const { client, createClient } = fakeConnection();
    await runDeploymentPreflight(validEnv, createClient, true);
    expect(createClient).toHaveBeenCalledWith(expect.objectContaining({
      connectionString: validEnv.DIRECT_URL,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 10_000,
      query_timeout: 10_000,
    }));
    const checks = client.query.mock.calls.map(([sql]) => sql);
    expect(checks.slice(0, 4)).toEqual([
      'BEGIN READ ONLY',
      'SELECT 1',
      'SELECT id, client_id, name FROM public.accounts LIMIT 0',
      'SELECT id FROM public.clients LIMIT 0',
    ]);
    expect(checks[4]).toContain('AS account_unique');
    expect(checks[4]).toContain('AS client_fk');
    expect(checks[4]).toContain('AS client_rls');
    expect(checks[5]).toBe('ROLLBACK');
    expect(client.end).toHaveBeenCalledOnce();
  });

  it('blocks deployment if required account constraints, FK or RLS are absent', async () => {
    const { client, createClient } = fakeConnection();
    client.query.mockImplementation(async (sql: string) => ({
      rows: sql.includes('AS account_unique')
        ? [{ account_unique: false, legacy_unique_absent: true, client_fk: true, client_rls: true }]
        : [],
    }));
    await expect(runDeploymentPreflight(validEnv, createClient, true)).rejects.toThrow(
      'Production preflight: DIRECT_URL connection or schema prerequisite check failed.',
    );
    expect(client.end).toHaveBeenCalledOnce();
  });

  it.each([
    ['wrapped TLS message', { cause: new Error('self-signed certificate in certificate chain') }, 'La cadena TLS contiene un certificado autofirmado no confiable.'],
    ['wrapped DNS message', { originalError: new Error('getaddrinfo ENOTFOUND private-host') }, 'DNS no pudo resolver el host PostgreSQL.'],
    ['authentication message', new Error('password authentication failed for user private-user'), 'PostgreSQL rechazó la autenticación. Verifica usuario y contraseña.'],
  ])('classifies %s without exposing the underlying message', async (_kind, failure, expected) => {
    const { client, createClient } = fakeConnection();
    client.connect.mockRejectedValue(failure);
    let message = '';
    try {
      await runDeploymentPreflight(validEnv, createClient);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(expected);
    expect(message).not.toMatch(/private-user|private-password|private-host/);
    expect(client.end).toHaveBeenCalledOnce();
  });

  it.each([
    ['DNS', 'ENOTFOUND', 'DNS no pudo resolver el host PostgreSQL.'],
    ['timeout', 'ETIMEDOUT', 'La conexión a PostgreSQL agotó el tiempo de espera.'],
    ['authentication', '28P01', 'PostgreSQL rechazó la autenticación. Verifica usuario y contraseña.'],
    ['TLS', 'SELF_SIGNED_CERT_IN_CHAIN', 'La cadena TLS contiene un certificado autofirmado no confiable.'],
  ])('reports a safe %s diagnostic without exposing driver details', async (_kind, code, expected) => {
    const { client, createClient } = fakeConnection();
    const sensitiveError = Object.assign(new Error('postgresql://private-user:private-password@private-host'), { code });
    client.connect.mockRejectedValue(sensitiveError);
    let message = '';
    try {
      await runDeploymentPreflight(validEnv, createClient);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(expected);
    expect(message).not.toMatch(/private-user|private-password|private-host/);
    expect(client.end).toHaveBeenCalledOnce();
  });


  it.each([
    ['DNS', 'getaddrinfo ENOTFOUND private-host', 'DNS no pudo resolver el host PostgreSQL.'],
    ['DNS temporal', 'EAI_AGAIN private-host', 'La resolución DNS de PostgreSQL falló temporalmente.'],
    ['timeout', 'connect ETIMEDOUT private-host:5432', 'La conexión a PostgreSQL agotó el tiempo de espera.'],
    ['conexión rechazada', 'connect ECONNREFUSED private-host:5432', 'El servidor rechazó la conexión TCP.'],
    ['conexión reiniciada', 'read ECONNRESET', 'La conexión TCP se cerró inesperadamente.'],
    ['TLS', 'certificate TLS validation failed', 'Falló la validación o negociación del certificado TLS con PostgreSQL.'],
  ])('classifies raw driver message for %s without leaking endpoint details', async (_kind, driverMessage, expected) => {
    const { client, createClient } = fakeConnection();
    client.connect.mockRejectedValue(new Error(driverMessage));
    let message = '';
    try {
      await runDeploymentPreflight(validEnv, createClient);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(expected);
    expect(message).not.toMatch(/private-host|5432/);
    expect(client.end).toHaveBeenCalledOnce();
  });

  it.each(['connect', 'query', 'construct'] as const)('sanitizes %s failures and releases the connection', async (stage) => {
    const { client, createClient } = fakeConnection();
    const sensitiveError = new Error(Object.values(validEnv).join(' '));
    if (stage === 'construct') createClient.mockImplementation(() => { throw sensitiveError; });
    else client[stage].mockRejectedValue(sensitiveError);
    await expect(runDeploymentPreflight(validEnv, createClient)).rejects.toThrow(
      'Production preflight: DIRECT_URL connection or schema prerequisite check failed.',
    );
    if (stage !== 'construct') expect(client.end).toHaveBeenCalledOnce();
  });
});

describe('production deployment workflow', () => {
  it('checks all deployment credentials before the migration can run', () => {
    const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');
    const deploy = workflow.split('  deploy-interpreters:')[1].split('  deploy-interpreters-api:')[0];
    const beforeMigration = deploy.split('      - name: Apply client directory migration before ownership constraints')[0];

    for (const name of ['DIRECT_URL', 'EASYPANEL_WEBHOOK_INTERPRETERS', 'EASYPANEL_WEBHOOK_API']) {
      expect(beforeMigration, `${name} must be checked before any migration`).toContain(`secrets.${name}`);
    }
    expect(beforeMigration).toContain('npx tsx scripts/deployment-preflight.ts');
  });

  it('applies client schema before ownership constraints and verifies it afterward', () => {
    const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');
    const deploy = workflow.split('  deploy-interpreters:')[1].split('  deploy-interpreters-api:')[0];
    const directoryMigration = deploy.indexOf('20261105140000_client_directory/migration.sql');
    const ownershipMigration = deploy.indexOf('20261105150000_account_names_per_client/migration.sql');
    const canonicalMigration = deploy.indexOf('20261105180000_client_directory/migration.sql');
    const schemaCheck = deploy.indexOf('scripts/deployment-preflight.ts --verify-schema');

    expect(directoryMigration).toBeGreaterThan(-1);
    expect(ownershipMigration).toBeGreaterThan(directoryMigration);
    expect(canonicalMigration).toBeGreaterThan(ownershipMigration);
    expect(schemaCheck).toBeGreaterThan(canonicalMigration);
  });

  it('normalizes DIRECT_URL in the migration runner without DATABASE_URL fallback', () => {
    const runner = readFileSync('scripts/run-migration.ts', 'utf8');
    expect(runner).toContain('normalizeDirectDatabaseUrl(process.env.DIRECT_URL)');
    expect(runner).not.toContain('process.env.DIRECT_URL || process.env.DATABASE_URL');
  });

  it.each([
    ['session pooler missing project-scoped user', 'postgresql://migration:private-password@region.pooler.supabase.com:5432/postgres', 'pooler'],
    ['transaction pooler port', 'postgresql://migration:private-password@db.example.com:6543/postgres', 'pooler'],
    ['override destination', 'postgresql://migration:private-password@db.example.com:5432/postgres?host=unsafe.example.com', 'redefinir'],
    ['internal whitespace', 'postgresql://migration:private password@db.example.com:5432/postgres', 'espacios internos'],
    ['non-database protocol', 'https://migration:private-password@db.example.com/postgres', 'PostgreSQL'],
  ])('standalone migrator rejects %s before connecting, without leaking credentials', (_scenario, url, expectedError) => {
    const result = spawnSync(process.execPath, [
      '--import', 'tsx', 'scripts/run-migration.ts',
      'prisma/migrations/20261105180000_client_directory/migration.sql',
      '--apply', '--transaction',
    ], {
      env: { ...process.env, DIRECT_URL: url, DATABASE_URL: validEnv.DIRECT_URL },
      encoding: 'utf8',
      timeout: 10_000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(expectedError);
    expect(result.stdout + result.stderr).not.toContain('private-password');
    expect(result.stdout + result.stderr).not.toContain('unsafe.example.com');
  });

  it('standalone migration dry run does not open a connection or require secrets', () => {
    const result = spawnSync(process.execPath, [
      '--import', 'tsx', 'scripts/run-migration.ts',
      'prisma/migrations/20261105180000_client_directory/migration.sql',
    ], {
      env: { ...process.env, DIRECT_URL: '', DATABASE_URL: '' },
      encoding: 'utf8',
      timeout: 10_000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('DRY RUN: no se conectó');
  });

  it('permits IPv4 Supabase session pooling only with project-scoped user on port 5432', () => {
    const session = 'postgresql://postgres.abcdefghijklmnopqrst:private-password@aws-1-us-east-1.pooler.supabase.com:5432/postgres';
    expect(normalizeDirectDatabaseUrl(session)).toBe(session);
    expect(validateDeploymentSecrets({ ...validEnv, DIRECT_URL: session })).toBe(session);
    expect(() => normalizeDirectDatabaseUrl(session.replace(':5432/', ':6543/'))).toThrow('pooler');
    expect(() => normalizeDirectDatabaseUrl(session.replace('postgres.abcdefghijklmnopqrst', 'postgres'))).toThrow('pooler');
    expect(() => normalizeDirectDatabaseUrl(session + '?pool_mode=transaction')).toThrow('transaccional');
  });

  it('shares direct URL validation between preflight and standalone runner', () => {
    const direct = ` \n${validEnv.DIRECT_URL}\r\n`;
    expect(normalizeDirectDatabaseUrl(direct)).toBe(validEnv.DIRECT_URL);
    expect(validateDeploymentSecrets({ ...validEnv, DIRECT_URL: direct })).toBe(validEnv.DIRECT_URL);
    expect(() => normalizeDirectDatabaseUrl(`${validEnv.DIRECT_URL}?pool_mode=transaction`)).toThrow('pooler');
  });

  it('serializes the whole pipeline without cancelling an active migration', () => {
    const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');
    const beforeJobs = workflow.split('\njobs:')[0];
    expect(beforeJobs).toContain('concurrency:');
    expect(beforeJobs).toContain('github.ref');
    expect(beforeJobs).toContain('cancel-in-progress: false');
  });
});


describe('manual production preflight workflow', () => {
  it('can check production credentials without running migrations or webhooks', () => {
    const workflow = readFileSync('.github/workflows/diagnose-production-connection.yml', 'utf8');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('environment: production');
    expect(workflow).toContain('run: npx tsx scripts/deployment-preflight.ts');
    for (const secret of ['DIRECT_URL', 'EASYPANEL_WEBHOOK_INTERPRETERS', 'EASYPANEL_WEBHOOK_API']) {
      expect(workflow).toContain(`secrets.${secret}`);
    }
    expect(workflow).not.toMatch(/\bpush:|\bpull_request:/u);
    expect(workflow).not.toMatch(/npm run migrate|--apply|--verify-schema|curl\s|Invoke-WebRequest|Call Easypanel Webhook/u);
  });
});
