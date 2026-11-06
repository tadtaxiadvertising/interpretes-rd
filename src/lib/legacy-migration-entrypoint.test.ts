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
