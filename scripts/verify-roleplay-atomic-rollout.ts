import type { Client } from 'pg';
import { loadRoleplayStagedInstallPlan, unwrapStagedRoleplaySql } from './roleplay-staged-install-plan';
import { readRoleplayDirectRolloutReadiness } from './roleplay-direct-rollout-readiness';
import { verifyExpandedRoleplayCapacityPilot } from './verify-roleplay-expanded-capacity-pilot';

function check(condition:unknown,message:string):asserts condition{
  if(!condition) throw new Error(message);
}

/** Invoked only on the freshly created random database of the existing
 * localhost CI verifier. Both successful rehearsal and deliberate failure
 * are rolled back; never an installer for a production database. */
export async function verifyRoleplayAtomicRollout(db:Client){
  const name=await db.query<{name:string}>('SELECT current_database() AS name');
  check(process.env.CI==='true'&&process.env.NODE_ENV!=='production'&&
    /^rp_upload_ci_[0-9a-f]{12}$/.test(name.rows[0]?.name??''),'Disposable database required');
  const plan=await loadRoleplayStagedInstallPlan();
  check(plan.length===6&&new Set(plan.map(p=>p.sha256)).size===6,'Invalid staged manifest');
  for(const invalid of [
    '-- STAGED ONLY\nBEGIN;\nSELECT 1;\nCOMMIT;\nCOMMIT;',
    '-- STAGED ONLY\nBEGIN;\nSELECT 1;',
    '-- STAGED ONLY\nBEGIN;\nCOMMIT;\nSELECT 1;',
  ]){
    let rejected=false;
    try{unwrapStagedRoleplaySql(invalid,true);}catch{rejected=true;}
    check(rejected,'Invalid SQL wrapper accepted');
  }
  // Minimal pre-existing app schema, created in the rehearsal transaction.
  // Real application tables are never dropped or rewritten by this helper.
  const base=`
    CREATE TYPE public."RoleplayStatus" AS ENUM ('DRAFT','INVITED','STARTED','IN_PROGRESS','SUBMITTED','UNDER_REVIEW','EVALUATED','PASSED','FAILED','CANCELLED','EXPIRED');
    CREATE TABLE public.roleplay_sessions(id text PRIMARY KEY,status public."RoleplayStatus" NOT NULL DEFAULT 'DRAFT',current_scenario_index integer NOT NULL DEFAULT 0);
    CREATE TABLE public.roleplay_scenarios(id text PRIMARY KEY,session_id text NOT NULL REFERENCES public.roleplay_sessions(id));
    CREATE TABLE public.roleplay_responses(id text PRIMARY KEY,scenario_id text NOT NULL REFERENCES public.roleplay_scenarios(id));
    INSERT INTO public.roleplay_sessions VALUES ('ci-legacy','STARTED',0);
    INSERT INTO public.roleplay_scenarios VALUES ('ci-legacy-turn','ci-legacy');
  `;
  async function ensureClean(){
    const r=await db.query<{clean:boolean}>(`
      SELECT to_regclass('public.roleplay_sessions') IS NULL
        AND to_regclass('public.roleplay_upload_reservations') IS NULL
        AND to_regclass('public.roleplay_final_write_claims') IS NULL
        AND to_regclass('public.roleplay_final_upload_evidence') IS NULL
        AND to_regclass('public.roleplay_direct_upload_budget') IS NULL
        AND to_regclass('public.roleplay_direct_upload_budget_charges') IS NULL
        AND to_regclass('public.roleplay_bilingual_openings') IS NULL
        AND to_regclass('public.roleplay_bilingual_opening_reservations') IS NULL
        AND to_regclass('public.roleplay_bilingual_opening_reviews') IS NULL
        AND to_regclass('public.roleplay_bilingual_opening_retired_paths') IS NULL
        AND to_regprocedure('public.release_never_signed_roleplay_capacity(uuid)') IS NULL AS clean
    `);
    check(r.rows[0]?.clean===true,'Partial schema survived rollback');
  }
  await ensureClean();
  await db.query('BEGIN');
  try{
    await db.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='15s'");
    await db.query(base);
    for(const step of plan) await db.query(step.sql);
    const ready=await readRoleplayDirectRolloutReadiness(db,{});
    check(ready.schemaMetadataReady&&ready.tableChecks.length===9&&ready.triggerChecks.length===11,
      'Combined staged schema did not pass catalog checks');
    check(ready.budget.remainingSlots===0&&ready.budget.releaseEnabled===false&&!ready.activationAuthorized,
      'New installation must remain disabled');
    await verifyExpandedRoleplayCapacityPilot(db);
    const legacy=await db.query<{required:boolean}>("SELECT requires_bilingual_opening AS required FROM public.roleplay_sessions WHERE id='ci-legacy'");
    check(legacy.rows[0]?.required===false,'Historical session became required');
    await db.query("INSERT INTO public.roleplay_responses VALUES ('ci-legacy-response','ci-legacy-turn'); UPDATE public.roleplay_sessions SET current_scenario_index=1,status='SUBMITTED' WHERE id='ci-legacy'");
    await db.query("INSERT INTO public.roleplay_sessions(id,status,requires_bilingual_opening) VALUES ('ci-required','STARTED',true)");
    await db.query('SAVEPOINT required_opening');
    let blocked=false;
    try{await db.query("UPDATE public.roleplay_sessions SET current_scenario_index=1 WHERE id='ci-required'");}
    catch(e){blocked=(e as {code?:string})?.code==='23514';}
    finally{await db.query('ROLLBACK TO SAVEPOINT required_opening');await db.query('RELEASE SAVEPOINT required_opening');}
    check(blocked,'Required opening guard did not block progression');
  }finally{await db.query('ROLLBACK');}
  await ensureClean();

  // A duplicate at step five must roll back the four earlier schema files,
  // not just the failed file. Assert the exact failure point and SQLSTATE.
  await db.query('BEGIN');
  let failedAt=0,code:unknown;
  try{
    await db.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='15s'");
    await db.query(base);
    await db.query('CREATE TABLE public.roleplay_direct_upload_budget(ci_collision boolean)');
    for(const step of plan){
      failedAt=step.order;
      await db.query(step.sql);
    }
    failedAt=0;
  }catch(e){code=(e as {code?:string})?.code;}
  finally{await db.query('ROLLBACK');}
  check(failedAt===5&&code==='42P07','Expected late schema collision was not observed');
  await ensureClean();
  console.log('Atomic Roleplay schema rehearsal passed: six staged SQL files, complete catalog, legacy compatibility, opening guard, zero capacity and rollback after late collision.');
}
