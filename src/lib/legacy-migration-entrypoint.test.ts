// @vitest-environment node
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('legacy migration entrypoint security', () => {
  it('fails closed and cannot bypass the shared DIRECT_URL transactional runner', () => {
    const legacyRunner = readFileSync('scripts/run_migration_v2.cjs', 'utf8');
    expect(legacyRunner).not.toContain('postgresql://');
    expect(legacyRunner).not.toContain('new Client');
    expect(legacyRunner).toContain('scripts/run-migration.ts');

    const result = spawnSync(process.execPath, ['scripts/run_migration_v2.cjs'], {
      env: {
        ...process.env,
        DIRECT_URL: '',
        DATABASE_URL: 'postgresql://unused@127.0.0.1:5432/unused',
      },
      encoding: 'utf8',
      timeout: 10_000,
    });

    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain('npm run migrate');
    expect(result.stdout + result.stderr).toContain('--apply --transaction');
  });
});

describe('canonical migration runner contract', () => {
  it('checks --transaction before constructing a database client', () => {
    const runner = readFileSync('scripts/run-migration.ts', 'utf8');
    const transactionGuard = runner.indexOf('if (!transactional)');
    const clientConstruction = runner.indexOf('new Client({ connectionString })');

    expect(transactionGuard).toBeGreaterThan(-1);
    expect(clientConstruction).toBeGreaterThan(-1);
    expect(transactionGuard).toBeLessThan(clientConstruction);
    expect(runner).toContain('normalizeDirectDatabaseUrl(process.env.DIRECT_URL)');
    expect(runner).not.toContain('process.env.DIRECT_URL || process.env.DATABASE_URL');
  });

  it('passes --transaction to every production migration invocation', () => {
    const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');
    const invocations = workflow.match(/^.*npm run migrate --.*$/gm) ?? [];

    expect(invocations.length).toBeGreaterThan(0);
    for (const invocation of invocations) {
      expect(invocation).toContain('--apply --transaction');
    }
  });
});
