import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { normalizeDirectDatabaseUrl } from './normalize-direct-database-url';
import { createDatabasePoolConfig } from '../src/lib/database-pool-config';
import { readRoleplayStorageBudgetAudit } from './roleplay-storage-budget-audit';
import { readRoleplayStorageRetentionReview } from './roleplay-storage-retention-review';
import { readRoleplayDirectRolloutReadiness } from './roleplay-direct-rollout-readiness';

async function main(){
  if(process.argv.slice(2).join(' ')!=='--check-only') throw new Error('Read-only mode required');
  const direct=normalizeDirectDatabaseUrl(process.env.DIRECT_URL);
  const config=createDatabasePoolConfig(direct,readFileSync(join(process.cwd(),'certs','prod-ca-2021.crt'),'utf8'));
  const client=new Client({connectionString:config.connectionString,ssl:config.ssl,
    connectionTimeoutMillis:10_000,statement_timeout:10_000,query_timeout:10_000,
    application_name:'interpretes-roleplay-storage-budget-readonly'});
  client.on('error',()=>undefined);
  let started=false;
  try{
    await client.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    started=true;
    const report=await readRoleplayStorageBudgetAudit(client);
    const retention=await readRoleplayStorageRetentionReview(client);
    const rollout=await readRoleplayDirectRolloutReadiness(client,process.env);
    await client.query('ROLLBACK');started=false;
    console.log(JSON.stringify({...report,retention,rollout},null,2));
    console.log('Metadata snapshot only. No refunds, deletions, quota changes or rollout approval.');
    if(!rollout.schemaMetadataReady || rollout.buckets.some(b=>b.state!=='metadata-ready') || report.budget.state==='incomplete' || report.budget.state==='review-required' ||
      report.inventory.unknownSizeObjects!=='0') process.exitCode=1;
  }finally{
    if(started) await client.query('ROLLBACK').catch(()=>undefined);
    await client.end();
  }
}
void main().catch(()=>{
  console.error('Read-only Roleplay storage budget audit failed.');
  process.exitCode=1;
});
