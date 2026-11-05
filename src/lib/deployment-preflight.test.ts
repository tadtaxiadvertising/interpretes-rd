// @vitest-environment node
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { runDeploymentPreflight, validateDeploymentSecrets } from '../../scripts/deployment-preflight';

const validEnv = {
  DIRECT_URL: 'postgresql://test:private-password@127.0.0.1:5432/isolated_test',
  EASYPANEL_WEBHOOK_INTERPRETERS: 'https://example.com/private-frontend-token',
  EASYPANEL_WEBHOOK_API: 'https://example.com/private-backend-token',
};

function fakeConnection() {
  const client = {
    connect: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue({ rows: [] }),
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
    ['EASYPANEL_WEBHOOK_API', `${validEnv.EASYPANEL_WEBHOOK_API}\n`],
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

  it('trims surrounding secret whitespace without weakening internal URL validation', () => {
    expect(validateDeploymentSecrets({
      ...validEnv,
      DIRECT_URL: `\r\n  ${validEnv.DIRECT_URL}  \r\n`,
    })).toBe(validEnv.DIRECT_URL);
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
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN READ ONLY',
      'SELECT id, client_id, name FROM public.accounts LIMIT 0',
      'SELECT id FROM public.clients LIMIT 0',
      'ROLLBACK',
    ]);
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

  it('serializes the whole pipeline without cancelling an active migration', () => {
    const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');
    const beforeJobs = workflow.split('\njobs:')[0];
    expect(beforeJobs).toContain('concurrency:');
    expect(beforeJobs).toContain('github.ref');
    expect(beforeJobs).toContain('cancel-in-progress: false');
  });
});
