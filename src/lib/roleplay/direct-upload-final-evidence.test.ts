import { describe,expect,it,vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { prepareRoleplayDirectUploadBatch } from './direct-upload-contract';
import { fingerprintRoleplayDirectUploadDeclarations } from './direct-upload-reservation-fingerprint';
import { consolidateDirectUploadSlot,loadConsolidatedClinicalPublication } from './direct-upload-final-evidence';
vi.mock('server-only',()=>({}));
const id='123e4567-e89b-42d3-a456-426614174000';
const key='123e4567-e89b-42d3-a456-426614174001';
const items=prepareRoleplayDirectUploadBatch(id,[0,1].map(order=>({order,mime:'audio/mpeg',sizeBytes:100,sha256:'a'.repeat(64)}))).items;
function fixture(){
  const createdAt=new Date(Date.now()-1000);
  const row={id,actorUserId:'admin',requestKey:key,status:'VERIFIED',items,
    declarationHash:fingerprintRoleplayDirectUploadDeclarations(items),
    verifiedObjects:items.map(item=>({order:item.order,path:item.path,sizeBytes:item.sizeBytes,sha256:item.sha256,verifiedAtMs:createdAt.getTime()})),
    createdAt,expiresAt:new Date(createdAt.getTime()+30*60_000)};
  const evidence:Array<{order:number;reference:string;sizeBytes:number;sha256:string;verifiedAt:Date}>=[];
  const findUnique=vi.fn().mockResolvedValue(row);
  const query=vi.fn(async(sql:TemplateStringsArray,...values:unknown[])=>{
    const statement=sql.join('');
    if(statement.includes('FOR UPDATE')) return [{id}];
    if(statement.includes('INSERT INTO public.roleplay_final_upload_evidence')){
      const [order,reference,sizeBytes,sha256,verifiedAt]=values as [number,string,number,string,Date];
      evidence.push({order,reference,sizeBytes,sha256,verifiedAt});
      return [{order}];
    }
    if(statement.includes('FROM public.roleplay_final_upload_evidence')) return evidence.slice();
    throw new Error('Unexpected SQL');
  });
  const tx={$queryRaw:query,roleplayUploadReservation:{findUnique}};
  const transaction=vi.fn(async(cb:(client:typeof tx)=>Promise<unknown>)=>cb(tx));
  const db={...tx,$transaction:transaction} as unknown as PrismaClient;
  const port={copyIfAbsent:vi.fn().mockResolvedValue(undefined),verify:vi.fn().mockResolvedValue({sizeBytes:100,sha256:items[0].sha256})};
  return {row,evidence,db,port,transaction,query};
}
describe('incremental final consolidation',()=>{
  it('persists one final object at a time and skips already recorded slots',async()=>{
    const f=fixture();
    expect(await consolidateDirectUploadSlot(f.db,f.port,'admin',key,0)).toEqual({verifiedCount:1,total:2,complete:false});
    expect(f.port.verify.mock.invocationCallOrder[0]).toBeLessThan(f.transaction.mock.invocationCallOrder[0]);
    expect(await consolidateDirectUploadSlot(f.db,f.port,'admin',key,0)).toMatchObject({verifiedCount:1});
    expect(f.port.copyIfAbsent).toHaveBeenCalledTimes(1);
    await expect(loadConsolidatedClinicalPublication(f.db,'admin',key)).rejects.toThrow('FINAL_CONSOLIDATION_INCOMPLETE');
    expect(await consolidateDirectUploadSlot(f.db,f.port,'admin',key,1)).toEqual({verifiedCount:2,total:2,complete:true});
    const complete=await loadConsolidatedClinicalPublication(f.db,'admin',key);
    expect(complete.final.map(item=>item.reference)).toEqual([0,1].map(order=>'private-base/'+id+'/'+order+'.mp3'));
  });
  it('rejects out-of-order and foreign reservations before Storage work',async()=>{
    const f=fixture();
    await expect(consolidateDirectUploadSlot(f.db,f.port,'admin',key,1)).rejects.toThrow('FINAL_SLOT_OUT_OF_ORDER');
    await expect(consolidateDirectUploadSlot(f.db,f.port,'other',key,0)).rejects.toThrow();
    expect(f.port.copyIfAbsent).not.toHaveBeenCalled();
    expect(f.transaction).not.toHaveBeenCalled();
  });
  it('does not commit failed final verification or cancellation',async()=>{
    const f=fixture();
    f.port.verify.mockResolvedValueOnce({sizeBytes:99,sha256:items[0].sha256});
    await expect(consolidateDirectUploadSlot(f.db,f.port,'admin',key,0)).rejects.toThrow('FINAL_AUDIO_UNVERIFIED');
    const abort=new AbortController();
    f.port.verify.mockImplementationOnce(async()=>{abort.abort();return {sizeBytes:100,sha256:items[0].sha256};});
    await expect(consolidateDirectUploadSlot(f.db,f.port,'admin',key,0,abort.signal)).rejects.toThrow('PUBLICATION_INTERRUPTED');
    expect(f.evidence).toHaveLength(0);
    expect(f.transaction).not.toHaveBeenCalled();
  });
  it('rejects tampered historical evidence before reuse',async()=>{
    const f=fixture();
    f.evidence.push({order:0,reference:'private-base/foreign/0.mp3',sizeBytes:100,sha256:items[0].sha256,verifiedAt:new Date()});
    await expect(consolidateDirectUploadSlot(f.db,f.port,'admin',key,0)).rejects.toThrow('FINAL_EVIDENCE_INVALID');
    expect(f.port.copyIfAbsent).not.toHaveBeenCalled();
  });
});
