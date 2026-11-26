import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { publishVerifiedInterpreterRoleplay } from './direct-upload-publish-interpreter';
import { prepareRoleplayDirectUploadBatch } from './direct-upload-contract';
import { fingerprintRoleplayDirectUploadDeclarations } from './direct-upload-reservation-fingerprint';

vi.mock('server-only', () => ({}));
const batchId = '123e4567-e89b-42d3-a456-426614174000';
const key = '123e4567-e89b-42d3-a456-426614174001';
const item = prepareRoleplayDirectUploadBatch(batchId,[{order:0,mime:'audio/mpeg',sizeBytes:100,sha256:'a'.repeat(64)}]).items[0];
const reference = 'private-base/' + batchId + '/0.mp3';
const target = 'base/' + batchId + '/0.mp3';
const input = {interpreterId:7,scenarios:[{title:'Medical turn',durationLimitSec:60,scriptPrompt:null,studioLanguage:'en'}]};
function fixture() {
  for(const flag of ['ROLEPLAY_BILINGUAL_OPENING_API_ENABLED','ROLEPLAY_BILINGUAL_OPENING_UI_ENABLED','ROLEPLAY_BILINGUAL_OPENING_ASSIGNMENT_ENABLED','ROLEPLAY_DIRECT_UPLOAD_PUBLICATION_ENABLED']) vi.stubEnv(flag,'true');
  const createdAt = new Date(Date.now()-1000);
  const row = {id:batchId,actorUserId:'admin',requestKey:key,status:'VERIFIED',items:[item],
    verifiedObjects:[{order:0,path:item.path,sizeBytes:item.sizeBytes,sha256:item.sha256,verifiedAtMs:createdAt.getTime()}],
    declarationHash:fingerprintRoleplayDirectUploadDeclarations([item]),createdAt,expiresAt:new Date(createdAt.getTime()+30*60_000)};
  const findUnique = vi.fn().mockResolvedValue(row);
  const updateMany = vi.fn().mockResolvedValue({count:1});
  const query = vi.fn().mockImplementation(async (sql:TemplateStringsArray,...values:unknown[]) =>
    sql.join('').includes('INSERT INTO public.roleplay_sessions') ? [{id:values[0],updatedAt:new Date()}] : []);
  const update = vi.fn().mockResolvedValue({});
  const findFirst = vi.fn().mockResolvedValue(null);
  const tx = {roleplayUploadReservation:{findUnique,updateMany},$queryRaw:query,
    roleplaySession:{update,findFirst},interpreter:{findFirst:vi.fn().mockResolvedValue({id:7})}};
  const transaction = vi.fn(async (cb:(value:typeof tx)=>Promise<unknown>)=>cb(tx));
  const db = {...tx,$transaction:transaction} as unknown as PrismaClient;
  const port = {copyIfAbsent:vi.fn().mockResolvedValue(undefined),verify:vi.fn().mockResolvedValue({sizeBytes:100,sha256:item.sha256})};
  return {db,port,row,findUnique,updateMany,query,update,findFirst,transaction};
}
afterEach(()=>vi.unstubAllEnvs());
describe('staged direct publication',()=>{
  it('promotes and verifies outside the transaction, then writes one session and receipt',async()=>{
    const f=fixture();
    const result=await publishVerifiedInterpreterRoleplay(f.db,f.port,'admin',key,input);
    expect(result.scenarioCount).toBe(1);
    expect(f.port.copyIfAbsent).toHaveBeenCalledWith(item,target);
    expect(f.port.verify).toHaveBeenCalledWith({...item,path:target});
    expect(f.port.verify.mock.invocationCallOrder[0]).toBeLessThan(f.transaction.mock.invocationCallOrder[0]);
    expect(f.update).toHaveBeenCalledWith({where:{id:result.sessionId},data:{scenarios:{create:[{...input.scenarios[0],order:0,baseAudioUrl:reference}]}}});
    expect(f.updateMany).toHaveBeenCalledWith(expect.objectContaining({data:{status:'PUBLISHED',publishedSessionIds:[result.sessionId]}}));
  });
  it('recovers an ambiguous copy only when destination bytes match',async()=>{
    const f=fixture(); f.port.copyIfAbsent.mockRejectedValueOnce(new Error('ambiguous'));
    expect(await publishVerifiedInterpreterRoleplay(f.db,f.port,'admin',key,input)).toHaveProperty('sessionId');
    const g=fixture(); g.port.copyIfAbsent.mockRejectedValueOnce(new Error('ambiguous'));
    g.port.verify.mockResolvedValueOnce({sizeBytes:99,sha256:item.sha256});
    await expect(publishVerifiedInterpreterRoleplay(g.db,g.port,'admin',key,input)).rejects.toThrow('FINAL_AUDIO_UNVERIFIED');
    expect(g.transaction).not.toHaveBeenCalled();
  });
  it('rejects unpublished, mismatched or foreign reservations before Storage changes',async()=>{
    for(const change of [{status:'RESERVED'},{actorUserId:'other'},{verifiedObjects:[]}]){
      const f=fixture();f.findUnique.mockResolvedValue({...f.row,...change});
      await expect(publishVerifiedInterpreterRoleplay(f.db,f.port,'admin',key,input)).rejects.toThrow();
      expect(f.port.copyIfAbsent).not.toHaveBeenCalled();
      expect(f.transaction).not.toHaveBeenCalled();
    }
  });
  it('propagates receipt conflict so the transaction must roll back',async()=>{
    const f=fixture();f.updateMany.mockResolvedValueOnce({count:0});
    await expect(publishVerifiedInterpreterRoleplay(f.db,f.port,'admin',key,input)).rejects.toThrow('NOT_CLAIMED');
    expect(f.updateMany).toHaveBeenCalledTimes(1);
  });
  it('rejects an existing assignment without writing a session',async()=>{
    const f=fixture();f.findFirst.mockResolvedValueOnce({id:'old'});
    await expect(publishVerifiedInterpreterRoleplay(f.db,f.port,'admin',key,input)).rejects.toThrow('PARTICIPANT_HAS_SESSION');
    expect(f.update).not.toHaveBeenCalled();
    expect(f.updateMany).not.toHaveBeenCalled();
  });
});
