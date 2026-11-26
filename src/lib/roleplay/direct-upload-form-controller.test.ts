import { describe,expect,it,vi } from 'vitest';
import { createDirectRoleplayFormController } from './direct-upload-form-controller';
const key='123e4567-e89b-42d3-a456-426614174000';
const receipt={sessionId:'session-123',scenarioCount:2,inviteLink:'https://app.example.test/roleplays/session-123'};
function fixture(){
  const assignment={interpreterId:7,scenarios:[0,1].map(i=>({title:'Turn '+i,durationLimitSec:60,scriptPrompt:null,studioLanguage:'en',studioTurn:i+1,sourceStartSec:i*10,sourceEndSec:(i+1)*10}))};
  const upload=vi.fn().mockResolvedValue({requestKey:key,verifiedCount:2,total:2});
  const consolidate=vi.fn(async(_key:string,order:number,_signal?:AbortSignal)=>({verifiedCount:order+1,total:2,complete:order===1}));
  const publish=vi.fn().mockResolvedValue(receipt);
  const controller=createDirectRoleplayFormController(assignment,{upload,consolidate,publish});
  return {assignment,upload,consolidate,publish,controller};
}
describe('direct roleplay form workflow',()=>{
  it('verifies and consolidates all slots before publication and freezes metadata',async()=>{
    const f=fixture(),onProgress=vi.fn();
    const original=structuredClone(f.assignment);
    f.assignment.scenarios[0].title='Changed';
    expect(await f.controller.run({onProgress})).toEqual(receipt);
    expect(f.consolidate.mock.calls.map(args=>args[1])).toEqual([0,1]);
    expect(f.consolidate.mock.invocationCallOrder[1]).toBeLessThan(f.publish.mock.invocationCallOrder[0]);
    expect(f.publish).toHaveBeenCalledWith(key,original,2,undefined);
    expect(onProgress).toHaveBeenLastCalledWith({phase:'published',verified:2,consolidated:2,total:2});
  });
  it('resumes the pending consolidation without a second upload',async()=>{
    const f=fixture();
    f.consolidate.mockResolvedValueOnce({verifiedCount:1,total:2,complete:false}).mockRejectedValueOnce(new Error('private provider detail'));
    await expect(f.controller.run()).rejects.toThrow('ROLEPLAY_DIRECT_OPERATION_INTERRUPTED');
    expect(f.publish).not.toHaveBeenCalled();
    expect(await f.controller.run()).toEqual(receipt);
    expect(f.upload).toHaveBeenCalledTimes(1);
    expect(f.consolidate.mock.calls.map(args=>args[1])).toEqual([0,1,1]);
  });
  it('retries only publication after ambiguous acknowledgement, preserving the request key',async()=>{
    const f=fixture();
    f.publish.mockRejectedValueOnce(new Error('lost response'));
    await expect(f.controller.run()).rejects.toThrow();
    expect(await f.controller.run()).toEqual(receipt);
    expect(await f.controller.run()).toEqual(receipt);
    expect(f.upload).toHaveBeenCalledTimes(1);
    expect(f.consolidate).toHaveBeenCalledTimes(2);
    expect(f.publish).toHaveBeenCalledTimes(2);
    expect(f.publish.mock.calls[0]).toEqual(f.publish.mock.calls[1]);
  });
  it('rejects invalid progress and pauses without publication',async()=>{
    const f=fixture();
    f.consolidate.mockResolvedValueOnce({verifiedCount:2,total:3,complete:false});
    await expect(f.controller.run()).rejects.toThrow();
    const abort=new AbortController();
    await expect(f.controller.run({signal:abort.signal,onProgress:p=>{if(p.phase==='consolidating')abort.abort();}})).rejects.toThrow();
    expect(f.publish).not.toHaveBeenCalled();
    expect(f.upload).toHaveBeenCalledTimes(1);
    expect(f.consolidate).toHaveBeenCalledTimes(1);
  });
});
