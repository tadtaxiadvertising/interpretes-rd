import 'dotenv/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { classifyRoleplayReservationCatalog, readRoleplayReservationCatalog } from './roleplay-upload-reservation-schema-catalog';
import { verifyFinalEvidencePostgres } from './verify-roleplay-final-evidence-postgres';
import { readRoleplayStorageBudgetAudit } from './roleplay-storage-budget-audit';
import { readRoleplayStorageRetentionReview } from './roleplay-storage-retention-review';

// ONLY a fresh, disposable PostgreSQL database on the isolated CI service.
// Never run against production, a shared DB or a remote hostname.
function isolatedCiUrl(): URL {
  const raw = process.env.DATABASE_URL;
  if (!raw || process.env.CI !== 'true' || process.env.NODE_ENV === 'production') {
    throw new Error('Disposable PostgreSQL CI required.');
  }
  const url = new URL(raw);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      url.pathname !== '/interpreters_e2e' ||
      url.username !== 'postgres' || url.port !== '5432') {
    throw new Error('Non-isolated PostgreSQL target rejected.');
  }
  return url;
}

type Row = {
  id: string; actor: string; key: string; hash: string; status: string;
  items: unknown; evidence: unknown; publishedSessionIds: unknown; created: Date; expires: Date;
};
const clip = [{
  order: 0, mime: 'audio/mpeg', sizeBytes: 3,
  sha256: 'a'.repeat(64),
  path: 'staging/roleplay/00000000-0000-4000-8000-000000000001/0.mp3',
}];

function row(overrides: Partial<Row> = {}): Row {
  const created = new Date();
  return {
    id: randomUUID(), actor: 'ci-admin-synthetic-A', key: randomUUID(),
    hash: 'b'.repeat(64), status: 'RESERVED',
    items: clip, evidence: [], publishedSessionIds: [], created,
    expires: new Date(created.getTime() + 30 * 60 * 1000),
    ...overrides,
  };
}

const insertSql = [
  'INSERT INTO public.roleplay_upload_reservations',
  '(id, actor_user_id, request_key, declaration_hash, status,',
  ' items, verified_objects, published_session_ids, created_at, expires_at)',
  'VALUES ($1::uuid,$2,$3::uuid,$4,$5,$6::jsonb,$7::jsonb,$8::text[],$9::timestamptz,$10::timestamptz)',
  'RETURNING id',
].join(' ');

function values(r: Row): unknown[] {
  return [r.id, r.actor, r.key, r.hash, r.status,
    JSON.stringify(r.items), JSON.stringify(r.evidence), r.publishedSessionIds, r.created, r.expires];
}

async function expectRejected(client: Client, input: Row, states: readonly string[]): Promise<void> {
  await client.query('SAVEPOINT invalid_reservation');
  let actual: string | undefined;
  try { await client.query(insertSql, values(input)); }
  catch (error) { actual = (error as { code?: string } | null)?.code; }
  finally {
    await client.query('ROLLBACK TO SAVEPOINT invalid_reservation');
    await client.query('RELEASE SAVEPOINT invalid_reservation');
  }
  if (!actual || !states.includes(actual)) {
    throw new Error('Invalid staged reservation was accepted or rejected incorrectly.');
  }
}

async function main(): Promise<void> {
  const source = isolatedCiUrl();
  const name = 'rp_upload_ci_' + randomBytes(6).toString('hex');
  const temp = new URL(source.toString());
  temp.pathname = '/' + name;
  const admin = new Client({ connectionString: source.toString() });
  let first: Client | undefined;
  let second: Client | undefined;
  let connected = false;
  let created = false;

  try {
    await admin.connect();
    connected = true;
    // Fixed prefix + random hex only: never drop a caller-supplied database.
    await admin.query('CREATE DATABASE "' + name + '" TEMPLATE template0');
    created = true;
    first = new Client({ connectionString: temp.toString() });
    second = new Client({ connectionString: temp.toString() });
    await first.connect();
    await second.connect();

    const sql = await readFile(resolve(
      process.cwd(), 'docs/operations/staged-sql/roleplay-upload-reservations.sql',
    ), 'utf8');
    if (!sql.includes('STAGED DESIGN ONLY')) throw new Error('Unexpected staged SQL.');
    await first.query(sql); // Autocommit ONLY inside this newly created database.

    // Execute the EXACT metadata reader used by the optional operator CLI,
    // not merely an ad-hoc SQL check in this isolated verifier.
    const preparedCatalog = await readRoleplayReservationCatalog(first);
    if (classifyRoleplayReservationCatalog(preparedCatalog) !== 'catalog-ready') {
      throw new Error('Staged Roleplay reservation catalog readiness failed.');
    }

    // Mutations below are inside a throwaway transaction in the throwaway DB.
    // An unexpected permissive policy must change the verdict to incomplete.
    await first.query('BEGIN');
    try {
      await first.query('SAVEPOINT simulated_unsafe_policy');
      await first.query(
        'CREATE POLICY ci_unapproved_upload_read ON public.roleplay_upload_reservations FOR SELECT USING (true)',
      );
      if (classifyRoleplayReservationCatalog(
        await readRoleplayReservationCatalog(first),
      ) !== 'incomplete') {
        throw new Error('Catalog accepted a new public RLS policy.');
      }
      await first.query('ROLLBACK TO SAVEPOINT simulated_unsafe_policy');
      await first.query('RELEASE SAVEPOINT simulated_unsafe_policy');

      await first.query('SAVEPOINT simulated_missing_constraint');
      await first.query(
        'ALTER TABLE public.roleplay_upload_reservations DROP CONSTRAINT roleplay_upload_reservations_actor_key',
      );
      if (classifyRoleplayReservationCatalog(
        await readRoleplayReservationCatalog(first),
      ) !== 'incomplete') {
        throw new Error('Catalog accepted a missing idempotency UNIQUE constraint.');
      }
      await first.query('ROLLBACK TO SAVEPOINT simulated_missing_constraint');
      await first.query('RELEASE SAVEPOINT simulated_missing_constraint');

      await first.query('SAVEPOINT simulated_missing_default');
      await first.query(
        'ALTER TABLE public.roleplay_upload_reservations ALTER COLUMN created_at DROP DEFAULT',
      );
      if (classifyRoleplayReservationCatalog(
        await readRoleplayReservationCatalog(first),
      ) !== 'incomplete') {
        throw new Error('Catalog accepted a missing creation timestamp default.');
      }
      await first.query('ROLLBACK TO SAVEPOINT simulated_missing_default');
      await first.query('RELEASE SAVEPOINT simulated_missing_default');
      await first.query('ROLLBACK');
    } catch (error) {
      await first.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
    if (classifyRoleplayReservationCatalog(
      await readRoleplayReservationCatalog(first),
    ) !== 'catalog-ready') {
      throw new Error('Catalog did not recover after rollback.');
    }

    const metadata = await first.query<{
      rls: boolean; policies: number; grants: number; unique_keys: number;
    }>([
      'SELECT c.relrowsecurity AS rls,',
      "(SELECT count(*)::int FROM pg_policies WHERE schemaname='public'",
      "AND tablename='roleplay_upload_reservations') AS policies,",
      "(SELECT count(*)::int FROM information_schema.role_table_grants",
      "WHERE table_schema='public' AND table_name='roleplay_upload_reservations'",
      "AND grantee IN ('PUBLIC','anon','authenticated')) AS grants,",
      "(SELECT count(*)::int FROM pg_constraint WHERE",
      "conrelid='public.roleplay_upload_reservations'::regclass",
      "AND conname='roleplay_upload_reservations_actor_key' AND contype='u') AS unique_keys",
      "FROM pg_class c WHERE c.oid='public.roleplay_upload_reservations'::regclass",
    ].join(' '));
    const meta = metadata.rows[0];
    if (metadata.rowCount !== 1 || meta?.rls !== true ||
        meta.policies !== 0 || meta.grants !== 0 || meta.unique_keys !== 1) {
      throw new Error('Staged reservation schema lacks isolation or uniqueness.');
    }

    // Actual two-connection race: only one insert may win for one actor/key.
    const a = row();
    const b = row({ actor: a.actor, key: a.key, hash: a.hash });
    const attempts = await Promise.allSettled([
      first.query(insertSql, values(a)),
      second.query(insertSql, values(b)),
    ]);
    const winners = attempts.filter(x => x.status === 'fulfilled');
    const losers = attempts.filter(x => x.status === 'rejected');
    if (winners.length !== 1 || losers.length !== 1 ||
        (losers[0] as PromiseRejectedResult).reason?.code !== '23505') {
      throw new Error('Same-owner duplicate request was not rejected by PostgreSQL.');
    }
    const count = await first.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM public.roleplay_upload_reservations WHERE actor_user_id=$1 AND request_key=$2',
      [a.actor, a.key],
    );
    if (count.rows[0]?.n !== 1) throw new Error('Duplicate reservation persisted.');

    // Same key for another owner is permitted, but does not share the claim.
    await first.query(insertSql, values(row({ actor: 'ci-admin-synthetic-B', key: a.key })));

    const winnerId = attempts[0].status === 'fulfilled' ? a.id : b.id;
    const verified = [{
      order: 0, path: clip[0].path, sizeBytes: 3,
      sha256: clip[0].sha256, verifiedAtMs: Date.now(),
    }];
    await first.query(
      "UPDATE public.roleplay_upload_reservations SET status='VERIFIED', verified_objects=$2::jsonb WHERE id=$1::uuid",
      [winnerId, JSON.stringify(verified)],
    );
    // A minimal synthetic session table exists ONLY inside this disposable
    // database; the future runtime transaction must create real Roleplay
    // sessions and update the reservation in the same unit of work.
    await first.query(
      'CREATE TABLE ci_roleplay_publication_sessions (id TEXT PRIMARY KEY)',
    );
    const publish = [
      "UPDATE public.roleplay_upload_reservations SET status='PUBLISHED',",
      'published_session_ids=$3::text[]',
      "WHERE id=$1::uuid AND actor_user_id=$2 AND status='VERIFIED'",
      'AND expires_at > CURRENT_TIMESTAMP RETURNING id',
    ].join(' ');
    const publishWithSession = async (
      client: Client, sessionId: string,
    ): Promise<boolean> => {
      await client.query('BEGIN');
      try {
        await client.query(
          'INSERT INTO ci_roleplay_publication_sessions (id) VALUES ($1)',
          [sessionId],
        );
        const updated = await client.query(publish, [winnerId, a.actor, [sessionId]]);
        if (updated.rowCount !== 1) {
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
    const publishRace = await Promise.all([
      publishWithSession(first, 'ci-session-a'),
      publishWithSession(second, 'ci-session-b'),
    ]);
    if (publishRace.filter(Boolean).length !== 1) {
      throw new Error('Double publication passed concurrent compare-and-swap.');
    }
    const receipt = await first.query<{ published_session_ids: string[] }>(
      'SELECT published_session_ids FROM public.roleplay_upload_reservations WHERE id=$1::uuid',
      [winnerId],
    );
    const expectedSession = publishRace[0] ? 'ci-session-a' : 'ci-session-b';
    const survivingSessions = await first.query<{ id: string }>(
      'SELECT id FROM ci_roleplay_publication_sessions',
    );
    if (receipt.rows[0]?.published_session_ids.join(',') !== expectedSession ||
        survivingSessions.rows.length !== 1 ||
        survivingSessions.rows[0]?.id !== expectedSession) {
      throw new Error('Publication receipt and committed sessions disagreed.');
    }

    await first.query('BEGIN');
    try {
      const original = row();
      const invalid: Array<[Row, string[]]> = [
        [row({ actor: '   ' }), ['23514']],
        [row({ actor: 'x'.repeat(257) }), ['23514']],
        [row({ hash: 'bad-hash' }), ['23514']],
        [row({ status: 'UNAUTHORIZED' }), ['23514']],
        [row({ items: [] }), ['23514']],
        [row({ items: Array.from({ length: 26 }, () => clip[0]) }), ['23514']],
        [row({ items: {} }), ['23514', '22023']],
        [row({ evidence: {} }), ['23514', '22023']],
        [row({ status: 'VERIFIED', evidence: [] }), ['23514']],
        [row({ status: 'PUBLISHED', evidence: [] }), ['23514']],
        [row({ status: 'PUBLISHED', evidence: verified, publishedSessionIds: [] }), ['23514']],
        [row({ status: 'RESERVED', publishedSessionIds: ['ci-session-orphan'] }), ['23514']],
        [row({ status: 'PUBLISHED', evidence: verified, publishedSessionIds: [''] }), ['23514']],
        [row({ status: 'PUBLISHED', evidence: verified, publishedSessionIds: [null] }), ['23514']],
        [row({ status: 'PUBLISHED', evidence: verified,
          publishedSessionIds: Array.from({ length: 1001 }, (_, i) => 'synthetic-session-' + i) }), ['23514']],
        [row({ created: original.created, expires: original.created }), ['23514']],
        [row({ created: original.created,
          expires: new Date(original.created.getTime() + 31 * 60 * 1000) }), ['23514']],
      ];
      for (const [candidate, codes] of invalid) {
        await expectRejected(first, candidate, codes);
      }
      const rollback = row();
      await first.query(insertSql, values(rollback));
      await first.query('ROLLBACK');
      const missing = await first.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM public.roleplay_upload_reservations WHERE id=$1::uuid',
        [rollback.id],
      );
      if (missing.rows[0]?.n !== 0) throw new Error('Transaction rollback retained fixture.');
    } catch (error) {
      await first.query('ROLLBACK').catch(() => undefined);
      throw error;
    }

    const old = new Date(Date.now() - 45 * 60 * 1000);
    const expired = row({
      created: old, expires: new Date(old.getTime() + 30 * 60 * 1000),
      status: 'VERIFIED', evidence: verified,
    });
    await first.query(insertSql, values(expired));
    const stalePublish = await first.query(publish, [expired.id, expired.actor, ['ci-expired-session']]);
    if (stalePublish.rowCount !== 0) throw new Error('Expired batch was published.');
    await verifyFinalEvidencePostgres(first, second);
    await first.query(await readFile(resolve(process.cwd(),'docs/operations/staged-sql/roleplay-final-write-claims.sql'),'utf8'));
    const claimParent=row({status:'VERIFIED',evidence:verified});
    claimParent.items=[{...clip[0],path:'staging/roleplay/'+claimParent.id+'/0.mp3'}];
    claimParent.evidence=[{...verified[0],path:(claimParent.items as typeof clip)[0].path,verifiedAtMs:claimParent.created.getTime()}];
    await first.query(insertSql,values(claimParent));
    const claimSql=`INSERT INTO public.roleplay_final_write_claims
      (reservation_id,slot_order,actor_user_id,request_key,reference,size_bytes,sha256)
      VALUES($1::uuid,0,$2,$3::uuid,$4,3,$5)
      ON CONFLICT (reservation_id,slot_order) DO NOTHING RETURNING slot_order`;
    const claimParams=[claimParent.id,claimParent.actor,claimParent.key,'private-base/'+claimParent.id+'/0.mp3','a'.repeat(64)];
    const claims=await Promise.all([first.query(claimSql,claimParams),second.query(claimSql,claimParams)]);
    if(claims.filter(result=>result.rowCount===1).length!==1 || claims.filter(result=>result.rowCount===0).length!==1)
      throw new Error('Final write claim admitted two writers');
    if((await first.query(claimSql,claimParams)).rowCount!==0) throw new Error('Final write claim was recycled');
    for(const statement of [
      'DELETE FROM public.roleplay_final_write_claims WHERE reservation_id=$1::uuid',
      'UPDATE public.roleplay_final_write_claims SET size_bytes=4 WHERE reservation_id=$1::uuid',
    ]){
      let code:unknown;
      try{await first.query(statement,[claimParent.id]);}catch(error){code=(error as {code?:string})?.code;}
      if(code!=='23514') throw new Error('Final write claim was mutable');
    }
    await first.query('DELETE FROM public.roleplay_upload_reservations WHERE id=$1::uuid',[claimParent.id]);
    const retained=await first.query('SELECT 1 FROM public.roleplay_final_write_claims WHERE reservation_id=$1::uuid',[claimParent.id]);
    if(retained.rowCount!==1) throw new Error('Final write claim was lost with reservation');
    console.log('Durable final write claim verified: concurrent admission, no replay writes, immutable claim, retained tombstone.');

    // Install the optional quota layer only after the baseline fixtures.
    await first.query(await readFile(resolve(process.cwd(),'docs/operations/staged-sql/roleplay-direct-upload-budget.sql'),'utf8'));
    await first.query('BEGIN');
    await expectRejected(first,row(),['23514']);
    await first.query('ROLLBACK');
    await first.query('UPDATE public.roleplay_direct_upload_budget SET max_slots=2 WHERE singleton=true');
    const quotaCandidates=[row(),row(),row()];
    const quotaRace=await Promise.allSettled([
      first.query(insertSql,values(quotaCandidates[0])),
      second.query(insertSql,values(quotaCandidates[1])),
    ]);
    if(quotaRace.some(result=>result.status!=='fulfilled')) throw new Error('Quota rejected available capacity');
    await first.query('BEGIN');
    await expectRejected(first,quotaCandidates[2],['23514']);
    await expectRejected(first,quotaCandidates[0],['23505']);
    await first.query('ROLLBACK');
    const allocated=await first.query<{allocated_slots:number;charges:number}>(`
      SELECT allocated_slots,(SELECT count(*)::int FROM public.roleplay_direct_upload_budget_charges) AS charges
      FROM public.roleplay_direct_upload_budget WHERE singleton=true
    `);
    if(allocated.rows[0]?.allocated_slots!==2 || allocated.rows[0]?.charges!==2) throw new Error('Quota accounting mismatch');
    await first.query('DELETE FROM public.roleplay_upload_reservations WHERE id=$1::uuid',[quotaCandidates[0].id]);
    await first.query('BEGIN');
    await expectRejected(first,quotaCandidates[2],['23514']);
    await first.query('ROLLBACK');
    // With one slot left, two independent processes must not both win.
    await first.query('UPDATE public.roleplay_direct_upload_budget SET max_slots=3 WHERE singleton=true');
    const last=await Promise.allSettled([first.query(insertSql,values(row())),second.query(insertSql,values(row()))]);
    if(last.filter(result=>result.status==='fulfilled').length!==1 ||
       last.some(result=>result.status==='rejected' && result.reason?.code!=='23514')) throw new Error('Quota race overspent');
    console.log('Persistent upload quota: zero by default, duplicate rollback, no delete refund and concurrent admission verified.');
    // Synthetic metadata table ONLY in this randomly named disposable DB.
    // Never create/modify the provider's actual storage schema.
    await first.query(`
      CREATE SCHEMA storage;
      CREATE TABLE storage.objects(bucket_id text,name text,metadata jsonb);
      INSERT INTO storage.objects VALUES
        ('roleplay-audio','synthetic-legacy','{"size":10}'),
        ('roleplay-audio-private','staging/roleplay/synthetic','{"size":20}'),
        ('roleplay-audio-private','base/synthetic','{"size":30}'),
        ('roleplay-opening-private','synthetic-opening','{"size":"invalid"}'),
        ('other-synthetic','synthetic-other','{}');
    `);
    await first.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try{
      const report=await readRoleplayStorageBudgetAudit(first);
      if(report.inventory.objects!=='5' || report.inventory.knownBytes!=='60' ||
         report.inventory.unknownSizeObjects!=='2' || report.refundAuthorized!==false ||
         report.budget.state!=='review-required' ||
         !('allocatedSlots' in report.budget) || report.budget.allocatedSlots!==3 ||
         report.budget.orphanCharges!==1 || report.budget.remainingSlots!==null ||
         report.inventory.byCategory.find(r=>r.category==='final')?.knownBytes!=='30')
        throw new Error('Storage aggregate audit misclassified synthetic fixtures');
    }finally{await first.query('ROLLBACK');}
    console.log('Read-only storage and budget inventory verified with synthetic metadata, orphan charges, unknown sizes and pre-budget reservations.');
    // Only synthetic reference columns, in the disposable database.
    if((await readRoleplayStorageRetentionReview(first)).state!=='schema-unavailable')
      throw new Error('Retention review accepted missing reference tables');
    await first.query(`
      CREATE TABLE public.roleplay_sessions(base_audio_url text,base_audio_path text,recorded_audio_url text);
      CREATE TABLE public.roleplay_scenarios(base_audio_url text);
      CREATE TABLE public.roleplay_responses(source_audio_url text,source_audio_path text,processed_audio_url text,processed_audio_path text);
    `);
    const referenced=randomUUID(),missingId=randomUUID();
    await first.query('INSERT INTO public.roleplay_scenarios VALUES($1)',['private-base/'+referenced+'/0.mp3']);
    await first.query(`INSERT INTO storage.objects(bucket_id,name,metadata) SELECT 'roleplay-audio-private',p,'{"size":3}'::jsonb FROM unnest($1::text[]) AS p`,[[
      'base/'+referenced+'/0.mp3',
      'base/'+claimParent.id+'/0.mp3',
      'base/'+missingId+'/0.mp3',
      'base/'+winnerId+'/0.mp3',
    ]]);
    await first.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try{
      const review=await readRoleplayStorageRetentionReview(first);
      const n=(category:string)=>review.categories.find(r=>r.category===category)?.objects;
      if(review.state!=='review-only'||review.deletionAuthorized!==false||review.refundAuthorized!==false||
         n('referenced')!=='1'||n('pending-write-claim')!=='1'||n('missing-reservation')!=='1'||
         n('published')!=='1'||n('unrecognized-path')!=='2')
        throw new Error('Retention review misclassified synthetic metadata');
    }finally{await first.query('ROLLBACK');}
    console.log('Retention review verified: referenced, published, unresolved claim, missing reservation and unknown paths are never deletion authorizations.');
    await first.query(await readFile(resolve(process.cwd(),'docs/operations/staged-sql/roleplay-unused-upload-capacity.sql'),'utf8'));
    await first.query('UPDATE public.roleplay_direct_upload_budget SET max_slots=5 WHERE singleton=true');
    const unused=row(),started=row();
    await first.query(insertSql,values(unused));
    await first.query(insertSql,values(started));
    const startSigning=`UPDATE public.roleplay_direct_upload_budget_charges c SET capability_state='SIGNING_STARTED'
      FROM public.roleplay_upload_reservations r WHERE r.id=c.reservation_id AND r.status='RESERVED'
        AND r.expires_at>clock_timestamp() AND c.capability_state='UNISSUED' AND c.reservation_id=$1::uuid RETURNING c.slots`;
    if((await first.query(startSigning,[started.id])).rowCount!==1) throw new Error('Signing intent not acquired');
    if((await second.query(startSigning,[started.id])).rowCount!==0) throw new Error('Signing intent recycled');
    const expire=async(id:string)=>first.query(`UPDATE public.roleplay_upload_reservations
      SET created_at=clock_timestamp()-interval '46 minutes',expires_at=clock_timestamp()-interval '17 minutes' WHERE id=$1::uuid`,[id]);
    await expire(unused.id);await expire(started.id);
    const release=(client:Client,id:string)=>client.query<{released:number}>('SELECT public.release_never_signed_roleplay_capacity($1::uuid) AS released',[id]);
    if((await release(first,unused.id)).rows[0]?.released!==0) throw new Error('Disabled release changed capacity');
    await first.query('UPDATE public.roleplay_direct_upload_budget SET unused_release_enabled=true WHERE singleton=true');
    if((await release(first,started.id)).rows[0]?.released!==0) throw new Error('Started signing charge was refunded');
    await expire(quotaCandidates[1].id);
    if((await release(first,quotaCandidates[1].id)).rows[0]?.released!==0) throw new Error('Untracked historical charge was refunded');
    const releaseRace=await Promise.all([release(first,unused.id),release(second,unused.id)]);
    if(releaseRace.map(r=>r.rows[0]?.released).sort().join(',')!=='0,1') throw new Error('Unused capacity release was not exactly once');
    if((await first.query(startSigning,[unused.id])).rowCount!==0) throw new Error('Released charge could sign');
    const restored=await first.query<{allocated_slots:number;capability_state:string;status:string}>(`
      SELECT b.allocated_slots,c.capability_state,r.status FROM public.roleplay_direct_upload_budget b
      CROSS JOIN public.roleplay_direct_upload_budget_charges c JOIN public.roleplay_upload_reservations r ON r.id=c.reservation_id
      WHERE b.singleton=true AND c.reservation_id=$1::uuid`,[unused.id]);
    if(restored.rows[0]?.allocated_slots!==4||restored.rows[0]?.capability_state!=='RELEASED'||restored.rows[0]?.status!=='CANCELLED')
      throw new Error('Release accounting or tombstone mismatch');
    const observed=row();
    await first.query(insertSql,values(observed));
    await expire(observed.id);
    await first.query('INSERT INTO storage.objects VALUES($1,$2,$3::jsonb)',['roleplay-audio-private','staging/roleplay/'+observed.id+'/0.mp3','{"size":3}']);
    if((await release(first,observed.id)).rows[0]?.released!==0) throw new Error('Observed object capacity was refunded');
    await first.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try{
      const report=await readRoleplayStorageBudgetAudit(first);
      if(!('releasedSlots' in report.budget)||report.budget.releasedSlots!==1||report.budget.releasedCharges!==1||
        report.budget.allocatedSlots!==5||report.budget.chargedSlots!==5||report.budget.signingStartedCharges!==1)
        throw new Error('Audit omitted released tombstone');
    }finally{await first.query('ROLLBACK');}
    console.log('Unused capacity verified: disabled default, irreversible signing intent, retained historical charges, exactly-once release and observed object protection.');




  } finally {
    await Promise.allSettled([first?.end(), second?.end()]);
    if (created && connected) {
      await admin.query('DROP DATABASE "' + name + '" WITH (FORCE)');
    }
    if (connected) await admin.end();
  }

  console.log('Roleplay reservation SQL validated on disposable PostgreSQL: constraints, RLS, concurrent deduplication, atomic publication receipt, expiration, rollback and database cleanup.');
}

void main().catch(() => {
  // Deliberately never print provider/database error payloads or credentials.
  console.error('Isolated Roleplay reservation SQL verification failed.');
  process.exitCode = 1;
});
