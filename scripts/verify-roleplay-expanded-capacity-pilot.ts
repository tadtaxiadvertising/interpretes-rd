import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';

function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

async function rejectCheck(db: Client, sql: string, params: unknown[] = []) {
  await db.query('SAVEPOINT capacity_negative');
  let code: unknown;
  try { await db.query(sql, params); }
  catch (error) { code = (error as { code?: string }).code; }
  finally {
    await db.query('ROLLBACK TO SAVEPOINT capacity_negative');
    await db.query('RELEASE SAVEPOINT capacity_negative');
  }
  check(code === '23514', 'Expanded pilot rejected incorrectly or accepted invalid data');
}

/** SQL-only experiment inside the existing atomic rehearsal transaction.
 * Never an install plan or authorization to increase live quota. */
export async function verifyExpandedRoleplayCapacityPilot(db: Client) {
  const database = await db.query<{ name: string }>('SELECT current_database() AS name');
  check(process.env.CI === 'true' && process.env.NODE_ENV !== 'production' &&
    /^rp_upload_ci_[0-9a-f]{12}$/.test(database.rows[0]?.name ?? ''), 'Disposable database required');
  await db.query('SAVEPOINT expanded_capacity_pilot');
  try {
    await rejectCheck(db, 'UPDATE public.roleplay_direct_upload_budget SET max_slots=50 WHERE singleton=true');
    // Hypothetical constraints for this rehearsal only. Keep triggers, RLS,
    // immutable claims, reference matching and per-file byte limits in place.
    await db.query(`
      ALTER TABLE public.roleplay_upload_reservations
        DROP CONSTRAINT roleplay_upload_reservations_items_check,
        ADD CONSTRAINT roleplay_upload_reservations_items_check
          CHECK (jsonb_typeof(items)='array' AND jsonb_array_length(items) BETWEEN 1 AND 50),
        DROP CONSTRAINT roleplay_upload_reservations_evidence_check,
        ADD CONSTRAINT roleplay_upload_reservations_evidence_check
          CHECK (jsonb_typeof(verified_objects)='array' AND jsonb_array_length(verified_objects) BETWEEN 0 AND 50
            AND (status NOT IN ('VERIFIED','PUBLISHED') OR jsonb_array_length(verified_objects)=jsonb_array_length(items)));
      ALTER TABLE public.roleplay_final_write_claims
        DROP CONSTRAINT roleplay_final_write_claims_slot_order_check,
        ADD CONSTRAINT roleplay_final_write_claims_slot_order_check CHECK (slot_order BETWEEN 0 AND 49);
      ALTER TABLE public.roleplay_final_upload_evidence
        DROP CONSTRAINT roleplay_final_upload_evidence_slot_order_check,
        ADD CONSTRAINT roleplay_final_upload_evidence_slot_order_check CHECK (slot_order BETWEEN 0 AND 49),
        DROP CONSTRAINT roleplay_final_upload_evidence_reference_check,
        ADD CONSTRAINT roleplay_final_upload_evidence_reference_check
          CHECK (reference ~ '^private-base/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/(0|[1-9]|[1-4][0-9])[.](mp3|wav|webm|mp4)$');
      ALTER TABLE public.roleplay_direct_upload_budget
        DROP CONSTRAINT roleplay_direct_upload_budget_max_slots_check,
        ADD CONSTRAINT roleplay_direct_upload_budget_max_slots_check CHECK (max_slots BETWEEN 0 AND 50);
      ALTER TABLE public.roleplay_direct_upload_budget_charges
        DROP CONSTRAINT roleplay_direct_upload_budget_charges_slots_check,
        ADD CONSTRAINT roleplay_direct_upload_budget_charges_slots_check CHECK (slots BETWEEN 1 AND 50);
    `);
    for (const count of [26, 50]) {
      await db.query('SAVEPOINT expanded_capacity_case');
      try {
        // Synthetic quota: 50 slots would reserve 1500 MiB in the real
        // conservative storage model. This test grants no hosted capacity.
        await db.query('UPDATE public.roleplay_direct_upload_budget SET max_slots=$1 WHERE singleton=true', [count]);
        const id = randomUUID(), request = randomUUID(), actor = 'ci-expanded-roleplay';
        const items = Array.from({ length: count }, (_, order) => ({
          order, mime: 'audio/mpeg', sizeBytes: 1024 * 1024, sha256: 'a'.repeat(64),
          path: 'staging/roleplay/' + id + '/' + order + '.mp3',
        }));
        const insert = "INSERT INTO public.roleplay_upload_reservations(id,actor_user_id,request_key,declaration_hash,items,created_at,expires_at) VALUES($1,$2,$3,$4,$5::jsonb,clock_timestamp()-interval '1 second',clock_timestamp()+interval '20 minutes')";
        await db.query(insert, [id, actor, request, 'b'.repeat(64), JSON.stringify(items)]);
        const quota = await db.query<{ allocated_slots: number }>('SELECT allocated_slots FROM public.roleplay_direct_upload_budget WHERE singleton=true');
        check(quota.rows[0]?.allocated_slots === count, 'Expanded reservation quota not charged');
        await rejectCheck(db, insert, [randomUUID(), actor, randomUUID(), 'b'.repeat(64), JSON.stringify(items.slice(0, 1))]);
        await rejectCheck(db, "UPDATE public.roleplay_upload_reservations SET status='VERIFIED' WHERE id=$1", [id]);
        const clock = await db.query<{ ms: string }>('SELECT floor(extract(epoch FROM clock_timestamp())*1000)::text AS ms');
        const verified = items.map(({ order, path, sizeBytes, sha256 }) => ({
          order, path, sizeBytes, sha256, verifiedAtMs: Number(clock.rows[0].ms),
        }));
        await db.query("UPDATE public.roleplay_upload_reservations SET status='VERIFIED',verified_objects=$2::jsonb WHERE id=$1", [id, JSON.stringify(verified)]);
        for (const item of items) {
          const reference = 'private-base/' + id + '/' + item.order + '.mp3';
          await db.query('INSERT INTO public.roleplay_final_write_claims(reservation_id,slot_order,actor_user_id,request_key,reference,size_bytes,sha256) VALUES($1,$2,$3,$4,$5,$6,$7)',
            [id, item.order, actor, request, reference, item.sizeBytes, item.sha256]);
          await db.query('INSERT INTO public.roleplay_final_upload_evidence(reservation_id,slot_order,reference,size_bytes,sha256,verified_at) VALUES($1,$2,$3,$4,$5,clock_timestamp())',
            [id, item.order, reference, item.sizeBytes, item.sha256]);
        }
        const totals = await db.query<{ claims: number; evidence: number }>(
          'SELECT (SELECT count(*)::int FROM public.roleplay_final_write_claims WHERE reservation_id=$1) AS claims,(SELECT count(*)::int FROM public.roleplay_final_upload_evidence WHERE reservation_id=$1) AS evidence', [id]);
        check(totals.rows[0]?.claims === count && totals.rows[0]?.evidence === count, 'Expanded evidence incomplete');
        await rejectCheck(db, 'UPDATE public.roleplay_final_write_claims SET size_bytes=2 WHERE reservation_id=$1 AND slot_order=$2', [id, count-1]);
        await rejectCheck(db, 'UPDATE public.roleplay_final_upload_evidence SET size_bytes=2 WHERE reservation_id=$1 AND slot_order=$2', [id, count-1]);
      } finally {
        await db.query('ROLLBACK TO SAVEPOINT expanded_capacity_case');
        await db.query('RELEASE SAVEPOINT expanded_capacity_case');
      }
    }
  } finally {
    await db.query('ROLLBACK TO SAVEPOINT expanded_capacity_pilot');
    await db.query('RELEASE SAVEPOINT expanded_capacity_pilot');
  }
  await rejectCheck(db, 'UPDATE public.roleplay_direct_upload_budget SET max_slots=50 WHERE singleton=true');
  const quota = await db.query<{ max_slots: number; allocated_slots: number }>('SELECT max_slots,allocated_slots FROM public.roleplay_direct_upload_budget WHERE singleton=true');
  check(quota.rows[0]?.max_slots === 0 && quota.rows[0]?.allocated_slots === 0, 'Expanded pilot changed baseline quota');
  console.log('Expanded capacity SQL rehearsal: synthetic 26/50 slots, evidence, write fences and rollback; no activation.');
}
