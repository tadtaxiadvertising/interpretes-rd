import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';

async function main() {
  const raw = process.env.DATABASE_URL;
  if (!raw || process.env.CI !== 'true' || process.env.NODE_ENV === 'production') {
    throw new Error('Disposable PostgreSQL CI required.');
  }
  const url = new URL(raw);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      url.pathname !== '/interpreters_e2e' || url.username !== 'postgres' || url.port !== '5432') {
    throw new Error('Non-isolated PostgreSQL target rejected.');
  }
  const name = 'rp_creation_ci_' + randomBytes(6).toString('hex');
  const admin = new Client({ connectionString: url.toString() });
  url.pathname = '/' + name;
  const first = new Client({ connectionString: url.toString() });
  const second = new Client({ connectionString: url.toString() });
  let created = false;
  try {
    await admin.connect();
    await admin.query('CREATE DATABASE "' + name + '" TEMPLATE template0');
    created = true;
    await first.connect();
    await second.connect();
    const sql = await readFile('docs/operations/staged-sql/roleplay-creation-requests.sql', 'utf8');
    assert.ok(sql.includes('STAGED DESIGN ONLY'));
    await first.query(sql);
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
    const results = await Promise.all([publish(first, 'synthetic-a'), publish(second, 'synthetic-b')]);
    assert.equal(results.filter(Boolean).length, 1);
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
    const other = await first.query(
      'SELECT status FROM public.roleplay_creation_requests WHERE actor_user_id=$1 AND request_key=$2',
      ['synthetic-admin-b', key],
    );
    assert.equal(other.rows[0]?.status, 'IN_PROGRESS');
    console.log('Isolated creation ledger: uniqueness, actor scope, rollback and receipt integrity passed.');
  } finally {
    await Promise.allSettled([first.end(), second.end()]);
    try {
      if (created) await admin.query('DROP DATABASE "' + name + '"');
    } finally {
      await admin.end();
    }
  }
}

main().catch(() => { console.error('Isolated creation ledger verification failed.'); process.exitCode = 1; });
