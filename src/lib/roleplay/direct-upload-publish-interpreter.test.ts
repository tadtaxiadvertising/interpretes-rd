import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { publishVerifiedInterpreterRoleplay, publishConsolidatedInterpreterRoleplay } from './direct-upload-publish-interpreter';
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
  const row = {id:batchId,actorUserId:'admin',requestKey:key,status:'VERIFIED',items:[item],publishedSessionIds:[] as string[],
    verifiedObjects:[{order:0,path:item.path,sizeBytes:item.sizeBytes,sha256:item.sha256,verifiedAtMs:createdAt.getTime()}],
    declarationHash:fingerprintRoleplayDirectUploadDeclarations([item]),createdAt,expiresAt:new Date(createdAt.getTime()+30*60_000)};
  const findUnique = vi.fn().mockResolvedValue(row);
  const updateMany = vi.fn().mockResolvedValue({count:1});
  const query = vi.fn().mockImplementation(async (sql:TemplateStringsArray,...values:unknown[]):Promise<unknown[]> =>
    sql.join('').includes('INSERT INTO public.roleplay_sessions') ? [{id:values[0],updatedAt:new Date()}] : sql.join('').includes('SELECT requires_bilingual_opening') ? [{required:true}] : []);
  const update = vi.fn().mockResolvedValue({});
  const findFirst = vi.fn().mockResolvedValue(null);
  const findSession = vi.fn().mockResolvedValue({id:'session-123',status:'INVITED',interpreterId:7,recruitmentCandidateId:null,baseAudioUrl:reference,baseAudioPath:reference,scenarios:[{...input.scenarios[0],order:0,baseAudioUrl:reference}]});
  const tx = {roleplayUploadReservation:{findUnique,updateMany},$queryRaw:query,
    roleplaySession:{update,findFirst,findUnique:findSession},interpreter:{findFirst:vi.fn().mockResolvedValue({id:7})}};
  const transaction = vi.fn(async (cb:(value:typeof tx)=>Promise<unknown>)=>cb(tx));
  const db = {...tx,$transaction:transaction} as unknown as PrismaClient;
  const port = {copyIfAbsent:vi.fn().mockResolvedValue(undefined),verify:vi.fn().mockResolvedValue({sizeBytes:100,sha256:item.sha256})};
  return {db,port,row,findUnique,updateMany,query,update,findFirst,findSession,transaction};
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
  it('recovers a committed receipt after expiry without transferring or writing anything',async()=>{
    const f=fixture();
    const createdAt=new Date(Date.now()-60*60_000);
    f.findUnique.mockResolvedValue({...f.row,status:'PUBLISHED',publishedSessionIds:['session-123'],createdAt,
      expiresAt:new Date(createdAt.getTime()+30*60_000),
      verifiedObjects:[{...f.row.verifiedObjects[0],verifiedAtMs:createdAt.getTime()}]});
    expect(await publishVerifiedInterpreterRoleplay(f.db,f.port,'admin',key,input)).toEqual({sessionId:'session-123',scenarioCount:1});
    expect(f.port.copyIfAbsent).not.toHaveBeenCalled();
    expect(f.port.verify).not.toHaveBeenCalled();
    expect(f.transaction).not.toHaveBeenCalled();
    expect(f.updateMany).not.toHaveBeenCalled();
  });
  it('rejects changed participant, scenario, or missing session rather than republishing',async()=>{
    for(const mode of ['participant','title','missing','path','opening']){
      const f=fixture();
      f.findUnique.mockResolvedValue({...f.row,status:'PUBLISHED',publishedSessionIds:['session-123']});
      if(mode==='missing') f.findSession.mockResolvedValueOnce(null);
      if(mode==='path') f.findSession.mockResolvedValueOnce({id:'session-123',status:'INVITED',interpreterId:7,recruitmentCandidateId:null,baseAudioUrl:reference,baseAudioPath:'other',scenarios:[]});
      if(mode==='opening') f.query.mockResolvedValueOnce([{required:false}]);
      const command=mode==='participant'?{...input,interpreterId:8}:mode==='title'?{...input,scenarios:[{...input.scenarios[0],title:'Changed'}]}:input;
      await expect(publishVerifiedInterpreterRoleplay(f.db,f.port,'admin',key,command)).rejects.toThrow('PUBLICATION_REVIEW_REQUIRED');
      expect(f.port.copyIfAbsent).not.toHaveBeenCalled();
      expect(f.transaction).not.toHaveBeenCalled();
    }
  });
  it('recovers a lost commit acknowledgement without repeating the transaction',async()=>{
    const f=fixture();
    f.transaction.mockImplementationOnce(async cb=>{
      await cb({roleplayUploadReservation:{findUnique:f.findUnique,updateMany:f.updateMany},$queryRaw:f.query,
        roleplaySession:{update:f.update,findFirst:f.findFirst,findUnique:f.findSession},interpreter:{findFirst:vi.fn().mockResolvedValue({id:7})}});
      const sessionId=f.updateMany.mock.calls[0][0].data.publishedSessionIds[0];
      f.findUnique.mockResolvedValue({...f.row,status:'PUBLISHED',publishedSessionIds:[sessionId]});
      f.findSession.mockResolvedValue({id:sessionId,status:'INVITED',interpreterId:7,recruitmentCandidateId:null,baseAudioUrl:reference,baseAudioPath:reference,scenarios:[{...input.scenarios[0],order:0,baseAudioUrl:reference}]});
      throw new Error('lost response');
    });
    expect(await publishVerifiedInterpreterRoleplay(f.db,f.port,'admin',key,input)).toMatchObject({scenarioCount:1});
    expect(f.transaction).toHaveBeenCalledTimes(1);
    expect(f.updateMany).toHaveBeenCalledTimes(1);
  });
  it('rejects an existing assignment without writing a session',async()=>{
    const f=fixture();f.findFirst.mockResolvedValueOnce({id:'old'});
    await expect(publishVerifiedInterpreterRoleplay(f.db,f.port,'admin',key,input)).rejects.toThrow('PARTICIPANT_HAS_SESSION');
    expect(f.update).not.toHaveBeenCalled();
    expect(f.updateMany).not.toHaveBeenCalled();
  });
});

describe('consolidated publication',()=>{
  it('commits two scenarios from complete trusted evidence and preserves source metadata',async()=>{
    const f=fixture();
    vi.stubEnv('ROLEPLAY_DIRECT_UPLOAD_INCREMENTAL_API_ENABLED','true');
    const items=prepareRoleplayDirectUploadBatch(batchId,[0,1].map(order=>({order,mime:'audio/mpeg',sizeBytes:100,sha256:'a'.repeat(64)}))).items;
    const row={...f.row,items,declarationHash:fingerprintRoleplayDirectUploadDeclarations(items),
      verifiedObjects:items.map(i=>({order:i.order,path:i.path,sizeBytes:i.sizeBytes,sha256:i.sha256,verifiedAtMs:f.row.createdAt.getTime()}))};
    f.findUnique.mockResolvedValue(row);
    const evidence=items.map(i=>({order:i.order,reference:'private-base/'+batchId+'/'+i.order+'.mp3',sizeBytes:i.sizeBytes,sha256:i.sha256,verifiedAt:new Date()}));
    f.query.mockImplementation(async(sql:TemplateStringsArray,...values:unknown[])=>{
      const statement=sql.join('');
      if(statement.includes('INSERT INTO public.roleplay_sessions')) return [{id:values[0],updatedAt:new Date()}];
      if(statement.includes('FOR UPDATE')) return [{id:batchId}];
      if(statement.includes('FROM public.roleplay_final_upload_evidence')) return evidence;
      return [];
    });
    const scenarios=[0,1].map(i=>({...input.scenarios[0],studioTurn:i+1,studioSpeaker:i===0?'speaker_1':'speaker_2',sourceStartSec:i*10,sourceEndSec:(i+1)*10}));
    const result=await publishConsolidatedInterpreterRoleplay(f.db,'admin',key,{interpreterId:7,scenarios});
    expect(result.scenarioCount).toBe(2);
    expect(f.update).toHaveBeenCalledWith({where:{id:result.sessionId},data:{scenarios:{create:scenarios.map((scenario,order)=>({...scenario,order,baseAudioUrl:evidence[order].reference}))}}});
    expect(f.updateMany).toHaveBeenCalledTimes(1);
    expect(f.port.copyIfAbsent).not.toHaveBeenCalled();
    expect(f.port.verify).not.toHaveBeenCalled();
  });
  it('refuses incomplete consolidation and invalid source ranges without starting writes',async()=>{
    const f=fixture();
    vi.stubEnv('ROLEPLAY_DIRECT_UPLOAD_INCREMENTAL_API_ENABLED','true');
    await expect(publishConsolidatedInterpreterRoleplay(f.db,'admin',key,input)).rejects.toThrow('FINAL_CONSOLIDATION_INCOMPLETE');
    await expect(publishConsolidatedInterpreterRoleplay(f.db,'admin',key,{...input,scenarios:[{...input.scenarios[0],sourceStartSec:4,sourceEndSec:2}]})).rejects.toThrow();
    expect(f.transaction).not.toHaveBeenCalled();
    expect(f.updateMany).not.toHaveBeenCalled();
  });
});
