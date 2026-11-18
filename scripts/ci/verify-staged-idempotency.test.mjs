import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { resolve } from 'node:path';

const root = process.cwd();
const stagedDir = resolve(root, 'docs/operations/staged-sql');
const migrationDir = resolve(root, 'prisma/migrations');
const drafts = [
  'call-submission-idempotency.sql',
  'call-submission-session-ownership.sql',
];

test('call idempotency DDL is staged outside Prisma auto-discovered migrations', () => {
  for (const name of drafts) {
    const staged = resolve(stagedDir, name);
    assert.equal(existsSync(staged), true, 'Staged DDL proposal must exist');
    assert.match(readFileSync(staged, 'utf8'), /STAGED ONLY/);
  }

  // A future "prisma migrate deploy" applies pending migration.sql files
  // regardless of whether the explicit CI deploy workflow names them.
  const entries = readdirSync(migrationDir, { recursive: true }).map(String);
  const forbidden = entries.filter(name =>
    /call_submission_(?:idempotency|session_ownership)/i.test(name),
  );
  assert.deepEqual(forbidden, [], 'Unapproved call idempotency migrations must not be discoverable by Prisma');

  // Renaming a migration folder must not bypass the safety gate. Examine
  // contents of every auto-discovered migration.sql, regardless of its name.
  for (const relative of entries) {
    if (!relative.endsWith('migration.sql')) continue;
    const sql = readFileSync(resolve(migrationDir, relative), 'utf8');
    assert.doesNotMatch(sql, /call_submission_keys/i,
      'Backend call idempotency schema is not approved for Prisma auto-deploy');
  }
});

test('isolated verifier reads only staged SQL and rolls back its changes', () => {
  const verifier = readFileSync(
    resolve(root, 'scripts/verify-call-submission-idempotency-migration.ts'), 'utf8',
  );
  for (const filename of drafts) {
    assert.ok(verifier.includes('docs/operations/staged-sql/' + filename));
  }
  assert.ok(verifier.includes("process.env.CI !== 'true'"));
  assert.ok(verifier.includes("url.pathname !== '/interpreters_e2e'"));
  assert.ok(verifier.includes("await client.query('ROLLBACK')"));
  assert.doesNotMatch(verifier, /prisma\/migrations\/20261118\d+_call_submission/);
});

test('production deploy keeps staged DDL out of migration steps', () => {
  const deploy = readFileSync(resolve(root, '.github/workflows/deploy.yml'), 'utf8');
  assert.match(deploy, /Verify proposed call submission idempotency schema \(isolated only\)/);
  assert.doesNotMatch(deploy, /(?:npm run migrate|prisma migrate deploy).*?(?:call-submission|call_submission)/);
});

test('the operational schema diagnostic cannot write or apply staged DDL', () => {
  const inspector = readFileSync(
    resolve(root, 'scripts/inspect-call-idempotency-schema.ts'), 'utf8',
  );
  assert.match(inspector, /BEGIN READ ONLY/);
  assert.match(inspector, /ROLLBACK/);
  assert.match(inspector, /--check-only/);
  assert.match(inspector, /--require-complete/);
  assert.match(inspector, /normalizeDirectDatabaseUrl/);
  assert.match(inspector, /createDatabasePoolConfig/);
  assert.doesNotMatch(inspector, /(?:INSERT INTO|DELETE FROM|ALTER TABLE|CREATE TABLE|DROP TABLE)\s+public\./i);

  const runbook = readFileSync(
    resolve(root, 'docs/operations/call-submission-idempotency-rollout.md'),
    'utf8',
  );
  assert.match(runbook, /inspect-call-idempotency-schema\.ts --check-only/);
  assert.match(runbook, /No existe un comando de aplicación autorizado/);
});
