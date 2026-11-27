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
  assert.ok(verifier.includes('readCallKeyCatalog(client)'));
  assert.ok(verifier.includes("completeState !== 'complete'"));
  assert.ok(verifier.includes("!== 'partial'"));
  assert.ok(verifier.includes("!== 'absent'"));
  assert.doesNotMatch(verifier, /prisma\/migrations\/20261118\d+_call_submission/);
});

test('production deploy keeps staged DDL out of migration steps', () => {
  const deploy = readFileSync(resolve(root, '.github/workflows/deploy.yml'), 'utf8');
  assert.match(deploy, /Verify proposed call submission idempotency schema \(isolated only\)/);
  assert.match(deploy, /Verify idempotency catalog classifier/);
  assert.match(deploy, /npx vitest run scripts\/call-idempotency-schema-state\.test\.ts/);
  assert.match(deploy, /Verify read-only idempotency catalog inspection \(isolated PostgreSQL\)/);
  assert.match(deploy, /npx tsx scripts\/inspect-call-idempotency-schema\.ts --check-only/);
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

test('roleplay upload reservation DDL remains staged and cannot be auto-deployed', () => {
  const name = 'roleplay-upload-reservations.sql';
  const candidate = resolve(stagedDir, name);
  assert.equal(existsSync(candidate), true, 'Staged upload reservation SQL must exist');
  const sql = readFileSync(candidate, 'utf8');
  assert.match(sql, /STAGED DESIGN ONLY/);
  assert.match(sql, /roleplay_upload_reservations_actor_key/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON TABLE/);

  // Reject accidental Prisma auto-discovery even if a migration is renamed.
  const entries = readdirSync(migrationDir, { recursive: true }).map(String);
  assert.deepEqual(entries.filter(name =>
    /roleplay_upload_reservations|roleplay.upload.reservations/i.test(name)), []);
  for (const relative of entries) {
    if (!relative.endsWith('migration.sql')) continue;
    const deployableSql = readFileSync(resolve(migrationDir, relative), 'utf8');
    assert.doesNotMatch(deployableSql, /roleplay_upload_reservations/i,
      'Proposed reservation table must not be auto-applied by Prisma');
  }

  const deployment = readFileSync(resolve(root, '.github/workflows/deploy.yml'), 'utf8');
  assert.doesNotMatch(deployment,
    /(?:npm run migrate|prisma migrate deploy)[^\n]*roleplay.upload.reservations/i);
});

test('staged Roleplay verifier targets a new disposable CI database only', () => {
  const script = readFileSync(
    resolve(root, 'scripts/verify-roleplay-upload-reservations-migration.ts'),
    'utf8',
  );
  const workflow = readFileSync(resolve(root, '.github/workflows/deploy.yml'), 'utf8');

  assert.ok(script.includes("process.env.CI !== 'true'"));
  assert.ok(script.includes("url.pathname !== '/interpreters_e2e'"));
  assert.ok(script.includes("url.username !== 'postgres'"));
  assert.ok(script.includes("url.port !== '5432'"));
  assert.ok(script.includes("randomBytes(6)"));
  assert.ok(script.includes('CREATE DATABASE'));
  assert.ok(script.includes('DROP DATABASE'));
  assert.ok(script.includes('Promise.allSettled'));
  assert.ok(script.includes("['23514']"));
  assert.ok(script.includes("await first.query('ROLLBACK')"));
  assert.doesNotMatch(script, /(?:migrate deploy|apply_migration|DIRECT_URL|supabaseAdmin)/i);

  assert.match(workflow, /Verify staged Roleplay upload reservations \(isolated PostgreSQL only\)/);
  assert.match(workflow, /npx tsx scripts\/verify-roleplay-upload-reservations-migration\.ts/);
  assert.doesNotMatch(workflow,
    /(?:npm run migrate|prisma migrate deploy)[^\n]*roleplay-upload-reservations/i);
});


test('historical roleplay creation ledger stays immutable and hardening stays staged', () => {
  const historicalPath = '20261121210000_roleplay_creation_idempotency_ledger/migration.sql';
  const historical = readFileSync(resolve(migrationDir, historicalPath), 'utf8');
  assert.match(historical, /roleplay_creation_requests_actor_key UNIQUE/);
  assert.match(historical, /ENABLE ROW LEVEL SECURITY/);
  assert.match(historical, /REVOKE ALL ON TABLE/);
  const staged = readFileSync(resolve(stagedDir, 'roleplay-creation-requests.sql'), 'utf8');
  assert.match(staged, /STAGED DESIGN ONLY/);
  assert.match(staged, /DROP CONSTRAINT roleplay_creation_requests_result_check/);
  assert.match(staged, /created_count IS NOT NULL AND created_count BETWEEN 1 AND 1000/);
  assert.doesNotMatch(staged, /CREATE TABLE/i);
  for (const relative of readdirSync(migrationDir, { recursive: true }).map(String)) {
    if (!relative.endsWith('migration.sql') || relative === historicalPath) continue;
    assert.doesNotMatch(readFileSync(resolve(migrationDir, relative), 'utf8'), /roleplay_creation_requests/i);
  }
  const verifier = readFileSync(resolve(root, 'scripts/verify-roleplay-creation-ledger-postgres.ts'), 'utf8');
  assert.match(verifier, /process\.env\.CI !== 'true'/);
  assert.match(verifier, /url\.pathname !== '\/interpreters_e2e'/);
  assert.match(verifier, /randomBytes\(6\)/);
  assert.match(verifier, /CREATE DATABASE/);
  assert.match(verifier, /DROP DATABASE/);
  assert.match(verifier, /Promise\.allSettled/);
  assert.match(verifier, /ROLLBACK/);
  assert.ok(verifier.includes('prisma/migrations/' + historicalPath));
  assert.ok(verifier.includes('docs/operations/staged-sql/roleplay-creation-requests.sql'));
  assert.ok(verifier.indexOf('await first.query(historical)') < verifier.indexOf('await first.query(sql)'));
  const workflow = readFileSync(resolve(root, '.github/workflows/deploy.yml'), 'utf8');
  assert.match(workflow, /Verify staged Roleplay creation ledger \(isolated PostgreSQL only\)/);
  assert.match(workflow, /npx tsx scripts\/verify-roleplay-creation-ledger-postgres\.ts/);
  assert.doesNotMatch(workflow, /(?:npm run migrate|prisma migrate deploy)[^\n]*roleplay.creation.requests/i);
});


test('creation ledger operator inspection is read-only and never runs in production deployment', () => {
  const inspector = readFileSync(resolve(root, 'scripts/inspect-roleplay-creation-ledger.ts'), 'utf8');
  const catalog = readFileSync(resolve(root, 'src/lib/roleplay/creation-ledger-catalog.ts'), 'utf8');
  assert.match(inspector, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.match(inspector, /ROLLBACK/);
  assert.match(inspector, /--check-only/);
  assert.match(inspector, /--require-hardened/);
  assert.match(inspector, /normalizeDirectDatabaseUrl/);
  assert.match(inspector, /createDatabasePoolConfig/);
  for (const script of [inspector, catalog]) {
    assert.doesNotMatch(script, /(?:INSERT INTO|DELETE FROM|UPDATE public\.|ALTER TABLE|CREATE TABLE|DROP TABLE)\s*public\./i);
    assert.doesNotMatch(script, /FROM\s+public\.roleplay_creation_requests\b/i);
  }
  const workflow = readFileSync(resolve(root, '.github/workflows/deploy.yml'), 'utf8');
  assert.doesNotMatch(workflow, /inspect-roleplay-creation-ledger\.ts/);
});


test('real Prisma creation lifecycle uses only the guarded disposable database', () => {
  const verifier = readFileSync(resolve(root, 'scripts/verify-roleplay-creation-ledger-postgres.ts'), 'utf8');
  const lifecycle = readFileSync(resolve(root, 'scripts/roleplay-creation-prisma-pilot.ts'), 'utf8');
  assert.match(verifier, /new PrismaPg\(\{ connectionString: url\.toString\(\)/);
  assert.ok(verifier.indexOf('url.pathname = \'/\' + name') < verifier.indexOf('new PrismaPg('));
  assert.ok(verifier.indexOf('created = true') < verifier.indexOf('new PrismaPg('));
  assert.match(verifier, /verifyPrismaCreationLifecycle\(prismaFirst, prismaSecond\)/);
  assert.ok(verifier.indexOf('client.$disconnect()') < verifier.indexOf('DROP DATABASE'));
  assert.match(lifecycle, /completeRoleplayCreationInTransaction\(tx,/);
  assert.match(lifecycle, /Promise\.allSettled/);
  assert.match(lifecycle, /recoverSingleRoleplayCreation/);
  assert.doesNotMatch(lifecycle, /process\.env|new PrismaClient|@\/lib\/prisma|supabaseAdmin|createClient\(/);
});
