// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
const m=vi.hoisted(()=>({auth:vi.fn(),bearer:vi.fn(),limit:vi.fn(),recover:vi.fn(),publish:vi.fn(),consolidated:vi.fn(),consolidate:vi.fn(),client:vi.fn(),opening:vi.fn(),port:vi.fn(),notify:vi.fn(),find:vi.fn(),revalidate:vi.fn()}));
vi.mock('@/lib/prisma',()=>({default:{roleplaySession:{findUnique:m.find}}}));
vi.mock('@/lib/auth/actions',()=>({validateAction:m.auth}));
vi.mock('@/lib/api-auth',()=>({actorFromBearer:m.bearer}));
vi.mock('@/lib/security/rate-limit',()=>({applyRateLimit:m.limit,rateLimit:m.limit,createRateLimitHeaders:()=>({})}));
vi.mock('@supabase/supabase-js',()=>({createClient:m.client}));
vi.mock('@/lib/roleplay/bilingual-opening-bucket',()=>({requireBilingualOpeningBucket:m.opening}));
vi.mock('@/lib/roleplay/direct-upload-final-storage',()=>({createFinalClinicalStoragePort:m.port}));
vi.mock('@/lib/roleplay/direct-upload-interpreter-recovery',()=>({recoverPublishedInterpreterRoleplay:m.recover}));
vi.mock('@/lib/roleplay/direct-upload-publish-interpreter',()=>({publishVerifiedInterpreterRoleplay:m.publish,publishConsolidatedInterpreterRoleplay:m.consolidated}));
vi.mock('@/lib/notifications/notify-roleplay',()=>({notifyRoleplayAssignments:m.notify}));
vi.mock('next/cache',()=>({revalidatePath:m.revalidate}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/roleplay/direct-upload-final-evidence',()=>({consolidateDirectUploadSlot:m.consolidate}));
import { POST } from './route';
import { POST as consolidate } from '../consolidate/route';
const key='123e4567-e89b-42d3-a456-426614174000';
const scenario={title:'Medical turn',durationLimitSec:60,scriptPrompt:null,studioLanguage:'en'};
const assignment={interpreterId:7,scenarios:[scenario]};
const payload={requestKey:key,assignment};
const receipt={sessionId:'session-123',scenarioCount:1};
function request(body:unknown=payload,headers:Record<string,string>={}){
  return new NextRequest('https://app.example.test/api/admin/roleplays/uploads/publish',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
}
beforeEach(()=>{
  vi.resetAllMocks();
  for(const flag of ['ROLEPLAY_DIRECT_UPLOAD_RESERVATION_API_ENABLED','ROLEPLAY_DIRECT_UPLOAD_VERIFICATION_API_ENABLED','ROLEPLAY_DIRECT_UPLOAD_PUBLICATION_ENABLED','ROLEPLAY_DIRECT_UPLOAD_PUBLICATION_PILOT_API_ENABLED','ROLEPLAY_BILINGUAL_OPENING_API_ENABLED','ROLEPLAY_BILINGUAL_OPENING_UI_ENABLED','ROLEPLAY_BILINGUAL_OPENING_ASSIGNMENT_ENABLED']) vi.stubEnv(flag,'true');
  vi.stubEnv('FRONTEND_ORIGIN','https://app.example.test');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://storage.example.test');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','test-only');
  m.auth.mockResolvedValue({user:{userId:'admin'}});
  m.limit.mockReturnValue({success:true});
  m.recover.mockResolvedValue(null);
  m.publish.mockResolvedValue(receipt);
  m.client.mockReturnValue({storage:{}});
  m.port.mockReturnValue({});
  m.find.mockResolvedValue({status:'INVITED',interpreterId:7,recruitmentCandidateId:null});
});
afterEach(()=>vi.unstubAllEnvs());
describe('staged individual publication API',()=>{
  it('is disabled by default and rejects cross-site and mismatched bearer requests',async()=>{
    vi.stubEnv('ROLEPLAY_DIRECT_UPLOAD_PUBLICATION_PILOT_API_ENABLED','');
    expect((await POST(request())).status).toBe(404);
    vi.stubEnv('ROLEPLAY_DIRECT_UPLOAD_PUBLICATION_PILOT_API_ENABLED','true');
    expect((await POST(request(payload,{'sec-fetch-site':'cross-site'}))).status).toBe(403);
    m.bearer.mockResolvedValue({role:'admin',userId:'another'});
    expect((await POST(request(payload,{authorization:'Bearer test'}))).status).toBe(403);
    expect(m.recover).not.toHaveBeenCalled();
    expect(m.publish).not.toHaveBeenCalled();
  });
  it('rejects invalid metadata, oversized body and multiple scenarios before storage',async()=>{
    for(const body of [{...payload,baseAudioUrl:'https://foreign.test'},{...payload,assignment:{...assignment,scenarios:[scenario,scenario]}},{...payload,extra:'x'.repeat(33000)}]){
      expect([400,409]).toContain((await POST(request(body))).status);
    }
    expect(m.client).not.toHaveBeenCalled();
    expect(m.recover).not.toHaveBeenCalled();
  });
  it('publishes only after opening storage preflight and returns the canonical invitation',async()=>{
    const response=await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({success:true,data:{...receipt,inviteLink:'https://app.example.test/roleplays/session-123'}});
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(m.opening.mock.invocationCallOrder[0]).toBeLessThan(m.publish.mock.invocationCallOrder[0]);
    expect(m.publish.mock.invocationCallOrder[0]).toBeLessThan(m.notify.mock.invocationCallOrder[0]);
    expect(m.notify).toHaveBeenCalledWith([{id:'session-123',interpreterId:7}]);
  });
  it('recovers committed receipt without accessing Storage or duplicating publication',async()=>{
    m.recover.mockResolvedValue(receipt);
    m.find.mockResolvedValue({status:'STARTED',interpreterId:7,recruitmentCandidateId:null});
    expect((await POST(request())).status).toBe(200);
    expect(m.client).not.toHaveBeenCalled();
    expect(m.publish).not.toHaveBeenCalled();
    expect(m.notify).not.toHaveBeenCalled();
  });
  it('fails closed on opening bucket failure or invalid frontend origin',async()=>{
    m.opening.mockRejectedValueOnce(new Error('private provider detail'));
    expect((await POST(request())).status).toBe(503);
    vi.stubEnv('FRONTEND_ORIGIN','https://app.example.test/other');
    expect((await POST(request())).status).toBe(503);
    expect(m.publish).not.toHaveBeenCalled();
    expect(m.notify).not.toHaveBeenCalled();
  });
});

describe('staged incremental publication API',()=>{
  it('requires separate incremental gate and delegates full publication without inline promotion',async()=>{
    const body={...payload,mode:'consolidated',assignment:{...assignment,scenarios:[scenario,scenario]}};
    vi.stubEnv('ROLEPLAY_DIRECT_UPLOAD_INCREMENTAL_API_ENABLED','');
    expect((await POST(request(body))).status).toBe(404);
    vi.stubEnv('ROLEPLAY_DIRECT_UPLOAD_INCREMENTAL_API_ENABLED','true');
    m.consolidated.mockResolvedValue({...receipt,scenarioCount:2});
    expect((await POST(request(body))).status).toBe(200);
    expect(m.consolidated).toHaveBeenCalledWith(expect.anything(),'admin',key,body.assignment,expect.any(AbortSignal));
    expect(m.publish).not.toHaveBeenCalled();
    expect(m.port).not.toHaveBeenCalled();
  });
  it('consolidates only one canonical position and rejects injected paths',async()=>{
    vi.stubEnv('ROLEPLAY_DIRECT_UPLOAD_INCREMENTAL_API_ENABLED','true');
    m.consolidate.mockResolvedValue({verifiedCount:1,total:2,complete:false});
    const response=await consolidate(request({requestKey:key,order:0}));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({success:true,data:{verifiedCount:1,total:2,complete:false}});
    expect(m.consolidate).toHaveBeenCalledWith(expect.anything(),expect.anything(),'admin',key,0,expect.any(AbortSignal));
    expect((await consolidate(request({requestKey:key,order:0,path:'foreign'}))).status).toBe(400);
    expect(m.consolidate).toHaveBeenCalledTimes(1);
    expect(m.notify).not.toHaveBeenCalled();
  });
});
