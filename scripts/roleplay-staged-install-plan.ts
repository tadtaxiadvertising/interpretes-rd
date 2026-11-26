import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Fixed reviewed files only. Never take SQL or paths from the CLI/user.
// No database connection or execution in this module.
const manifest=[
  {file:'roleplay-bilingual-openings.sql',wrapped:true},
  {file:'roleplay-upload-reservations.sql',wrapped:false},
  {file:'roleplay-final-write-claims.sql',wrapped:true},
  {file:'roleplay-final-upload-evidence.sql',wrapped:true},
  {file:'roleplay-direct-upload-budget.sql',wrapped:true},
  {file:'roleplay-unused-upload-capacity.sql',wrapped:true},
] as const;

/** These exact staged sources have either no transaction wrapper or one
 * standalone outer BEGIN/COMMIT. Reject wrapper drift rather than execute a
 * nested COMMIT. Not a general SQL parser; only the fixed reviewed manifest. */
export function unwrapStagedRoleplaySql(source:string,wrapped:boolean){
  if(!/^-- STAGED (?:ONLY|DESIGN ONLY)\b/.test(source)) throw new Error('STAGED_SOURCE_REQUIRED');
  const lines=source.split(/\r?\n/);
  const tx=lines.map((line,index)=>({line:line.trim(),index})).filter(({line})=>/^(BEGIN|START TRANSACTION|COMMIT|END|ROLLBACK|ABORT|PREPARE TRANSACTION)\b.*;$/i.test(line));
  // PL/pgSQL block END is followed by a dollar delimiter (or END IF/LOOP);
  // standalone END; within a function is not a transaction command.
  const outer=tx.filter(({line})=>/^(BEGIN|START TRANSACTION|COMMIT|ROLLBACK|ABORT|PREPARE TRANSACTION)\b.*;$/i.test(line));
  if(!wrapped){
    if(outer.length!==0) throw new Error('UNEXPECTED_TRANSACTION_WRAPPER');
    return source;
  }
  const first=lines.findIndex(line=>line.trim()&&!line.trim().startsWith('--'));
  const last=lines.findLastIndex(line=>line.trim()!=='');
  if(outer.length!==2||outer[0].index!==first||outer[0].line!=='BEGIN;'||
      outer[1].index!==last||outer[1].line!=='COMMIT;') throw new Error('INVALID_TRANSACTION_WRAPPER');
  return lines.filter((_,index)=>index!==first&&index!==last).join('\n');
}

export async function loadRoleplayStagedInstallPlan(){
  return Promise.all(manifest.map(async({file,wrapped},index)=>{
    const source=await readFile(resolve(process.cwd(),'docs/operations/staged-sql',file),'utf8');
    return {order:index+1,file,sha256:createHash('sha256').update(source).digest('hex'),sql:unwrapStagedRoleplaySql(source,wrapped)};
  }));
}
