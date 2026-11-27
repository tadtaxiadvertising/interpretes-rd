import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { readRoleplayCreationCiTarget } from './roleplay-creation-ci-target.mjs';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { isCreationLedgerReady } from '../src/lib/roleplay/creation-ledger-readiness';
import { verifyPrismaCreationLifecycle } from './roleplay-creation-prisma-pilot';
import { classifyCreationLedgerCatalog, readCreationLedgerCatalog, hasCreationLedgerRuntimeAccess } from './roleplay-creation-ledger-catalog';

async function main() {
  const target = readRoleplayCreationCiTarget(process.env);
  const name = 'rp_creation_ci_' + randomBytes(6).toString('hex');
  const admin = new Client(target);
  const isolatedTarget = { ...target, database: name };
  const first = new Client(isolatedTarget);
  const second = new Client(isolatedTarget);
  let created = false;
  const prismaClients: PrismaClient[] = [];
  try {
    await admin.connect();
    await admin.query('CREATE DATABASE "' + name + '" TEMPLATE template0');
    created = true;
    await first.connect();
    await second.connect();
    // Explicit adapter configuration derived only from the guarded, newly created DB.
    // Never instantiate the application's environment-driven singleton.
    for (let i = 0; i < 2; i++) {
      prismaClients.push(new PrismaClient({
        adapter: new PrismaPg({ ...isolatedTarget, max: 2 }),
      }));
    }
    const [prismaFirst, prismaSecond] = prismaClients;
    assert.equal(await isCreationLedgerReady(prismaFirst), false);
    const inspect = async () => {
      await first!.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      try { return classifyCreationLedgerCatalog(await readCreationLedgerCatalog(first!)); }
      finally { await first!.query('ROLLBACK'); }
    };
    assert.equal(await inspect(), 'absent');
    // Apply the unchanged historical migration first, then the proposed
    // constraint hardening. Both execute only in this newly created DB.
    const historical = await readFile('prisma/migrations/20261121210000_roleplay_creation_idempotency_ledger/migration.sql', 'utf8');
    await first.query(historical);
    assert.equal(await inspect(), 'historical');
    assert.equal(await isCreationLedgerReady(prismaFirst), false);
    const sql = await readFile('docs/operations/staged-sql/roleplay-creation-requests.sql', 'utf8');
    assert.ok(sql.includes('STAGED DESIGN ONLY'));
    await first.query(sql);
    assert.equal(await inspect(), 'hardened-catalog');
    assert.equal(await isCreationLedgerReady(prismaFirst), true);
    // Exercise effective role access in the isolated database, without
    // creating any cluster-wide roles or granting privileges.
    await first.query('BEGIN READ ONLY');
    try {
      assert.equal(await hasCreationLedgerRuntimeAccess(first), true);
      await first.query('SET LOCAL ROLE pg_read_all_data');
      assert.equal(await hasCreationLedgerRuntimeAccess(first), false);
    } finally { await first.query('ROLLBACK'); }
    // Mutations occur only in the disposable database, never in the inspector.
    await first.query('BEGIN');
    try {
      await first.query('SAVEPOINT unsafe_grant');
      await first.query('GRANT SELECT (id) ON public.roleplay_creation_requests TO PUBLIC');
      assert.equal(classifyCreationLedgerCatalog(await readCreationLedgerCatalog(first)), 'incomplete');
      await first.query('ROLLBACK TO SAVEPOINT unsafe_grant');
      await first.query('SAVEPOINT unsafe_policy');
      await first.query('CREATE POLICY ci_unsafe_read ON public.roleplay_creation_requests FOR SELECT USING (true)');
      assert.equal(classifyCreationLedgerCatalog(await readCreationLedgerCatalog(first)), 'incomplete');
      await first.query('ROLLBACK TO SAVEPOINT unsafe_policy');
      await first.query('ALTER TABLE public.roleplay_creation_requests DROP CONSTRAINT roleplay_creation_requests_actor_key');
      assert.equal(classifyCreationLedgerCatalog(await readCreationLedgerCatalog(first)), 'incomplete');
    } finally { await first.query('ROLLBACK'); }
    assert.equal(await inspect(), 'hardened-catalog');
    const meta = await first.query(
      "SELECT relrowsecurity FROM pg_class WHERE oid = 'public.roleplay_creation_requests'::regclass",
    );
    assert.equal(meta.rows[0]?.relrowsecurity, true);
    const policies = await first.query(
      "SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='public' AND tablename='roleplay_creation_requests'",
    );
    assert.equal(policies.rows[0]?.n, 0);
    const grants = await first.query(
      "SELECT count(*)::int AS n FROM information_schema.table_privileges WHERE table_schema='public' AND table_name='roleplay_creation_requests' AND grantee IN ('PUBLIC','anon','authenticated')",
    );
    assert.equal(grants.rows[0]?.n, 0);

    const actor = 'synthetic-admin-a';
    const key = randomUUID();
    const hash = 'a'.repeat(64);
    const insert = 'INSERT INTO public.roleplay_creation_requests (id,actor_user_id,request_key,payload_hash) VALUES ($1,$2,$3,$4)';
    const attempts = await Promise.allSettled([
      first.query(insert, [randomUUID(), actor, key, hash]),
      second.query(insert, [randomUUID(), actor, key, hash]),
    ]);
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
    const rejected = attempts.find(result => result.status === 'rejected');
    assert.equal(rejected?.reason?.code, '23505');
    await first.query(insert, [randomUUID(), 'synthetic-admin-b', key, hash]);

    // Only synthetic IDs; the real publisher is still disconnected.
    await first.query('CREATE TABLE ci_creation_sessions (id TEXT PRIMARY KEY)');
    const publish = async (client: Client, id: string) => {
      await client.query('BEGIN');
      try {
        await client.query('INSERT INTO ci_creation_sessions (id) VALUES ($1)', [id]);
        const result = await client.query(
          "UPDATE public.roleplay_creation_requests SET status='COMPLETED',session_ids=$4,created_count=1,skipped_count=0,scenario_count=1,completed_at=now() WHERE actor_user_id=$1 AND request_key=$2 AND payload_hash=$3 AND status='IN_PROGRESS'",
          [actor, key, hash, [id]],
        );
        if (result.rowCount !== 1) {
          await client.query('ROLLBACK');
          return false;
        }
        await client.query('COMMIT');
        return true;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
    };
    const results = await Promise.allSettled([publish(first, 'synthetic-a'), publish(second, 'synthetic-b')]);
    assert.ok(results.every(result => result.status === 'fulfilled'));
    assert.equal(results.filter(result => result.status === 'fulfilled' && result.value).length, 1);
    const sessions = await first.query('SELECT id FROM ci_creation_sessions');
    assert.equal(sessions.rowCount, 1);
    const receipt = await first.query(
      'SELECT status, session_ids, created_count FROM public.roleplay_creation_requests WHERE actor_user_id=$1 AND request_key=$2',
      [actor, key],
    );
    assert.equal(receipt.rows[0]?.status, 'COMPLETED');
    assert.deepEqual(receipt.rows[0]?.session_ids, [sessions.rows[0]?.id]);
    assert.equal(receipt.rows[0]?.created_count, 1);
    // An invalid receipt must not be persisted, including null counters.
    await assert.rejects(first.query(
      "UPDATE public.roleplay_creation_requests SET status='COMPLETED', completed_at=now() WHERE actor_user_id=$1 AND request_key=$2",
      ['synthetic-admin-b', key],
    ), { code: '23514' });
    // Even with a correct counter cardinality, oversized receipts must fail.
    await assert.rejects(first.query(
      "UPDATE public.roleplay_creation_requests SET status='COMPLETED', completed_at=now(), session_ids=$3, created_count=1001, skipped_count=0, scenario_count=1 WHERE actor_user_id=$1 AND request_key=$2",
      ['synthetic-admin-b', key, Array.from({ length: 1001 }, (_, index) => 'synthetic-' + index)],
    ), { code: '23514' });
    const other = await first.query(
      'SELECT status FROM public.roleplay_creation_requests WHERE actor_user_id=$1 AND request_key=$2',
      ['synthetic-admin-b', key],
    );
    assert.equal(other.rows[0]?.status, 'IN_PROGRESS');
    console.log('Isolated creation ledger: uniqueness, actor scope, rollback and receipt integrity passed.');
    // Minimal synthetic projection for the actual Prisma receipt reader.
    // This does not pretend to reproduce the full RoleplaySession model.
    await first.query('CREATE TABLE public.roleplay_sessions (id TEXT PRIMARY KEY)');
    await verifyPrismaCreationLifecycle(prismaFirst, prismaSecond);
  } finally {
    await Promise.allSettled(prismaClients.map(client => client.$disconnect()));
    await Promise.allSettled([first.end(), second.end()]);
    try {
      if (created) await admin.query('DROP DATABASE "' + name + '"');
    } finally {
      await admin.end();
    }
  }
}

main().catch(() => { console.error('Isolated creation ledger verification failed.'); process.exitCode = 1; });
