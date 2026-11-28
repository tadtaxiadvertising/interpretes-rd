// @vitest-environment jsdom
import { describe,expect,it,vi } from 'vitest';
import { createRoleplayUploadController } from './direct-upload-browser-resume';
import { prepareRoleplayDirectUploadBatch } from './direct-upload-contract';
const batchId='123e4567-e89b-42d3-a456-426614174000';
function fixture(){
  const files=[0,1].map(i=>new File(['ID3'+i],i+'.mp3',{type:'audio/mpeg'}));
  const declarations=files.map((file,order)=>({order,mime:file.type,sizeBytes:file.size,sha256:'a'.repeat(64)}));
  const slots=prepareRoleplayDirectUploadBatch(batchId,declarations).items.map(item=>({...item,token:'private-token-'+item.order}));
  const reserve=vi.fn().mockResolvedValue({kind:'CREATED',batchId,expiresAt:new Date(Date.now()+25*60_000).toISOString(),slots});
  const inspect=vi.fn();
  const verify=vi.fn(async(_key:string,order:number)=>({kind:'PROGRESS',verifiedCount:order+1,total:2,complete:order===1}));
  const transfer=vi.fn().mockResolvedValue({error:null});
  const hash=vi.fn().mockResolvedValue(declarations);
  const controller=createRoleplayUploadController(files,{reserve,inspect,verify,transfer},hash);
  return {controller,reserve,inspect,verify,transfer,hash,slots};
}
describe('same-tab roleplay upload recovery',()=>{
  it('transfers then verifies each file sequentially and returns no tokens',async()=>{
    const f=fixture();
    const result=await f.controller.run();
    expect(result).toEqual({requestKey:expect.any(String),verifiedCount:2,total:2});
    expect(f.reserve).toHaveBeenCalledTimes(1);
    expect(f.inspect).not.toHaveBeenCalled();
    expect(f.verify.mock.invocationCallOrder[0]).toBeLessThan(f.transfer.mock.invocationCallOrder[1]);
    expect(JSON.stringify(result)).not.toContain('private-token');
  });
  it('recovers a lost transfer reply without retransferring the observed object',async()=>{
    const f=fixture();
    f.transfer.mockRejectedValueOnce(new Error('private-token'));
    await expect(f.controller.run()).rejects.toThrow('ROLEPLAY_UPLOAD_INTERRUPTED');
    f.inspect.mockResolvedValueOnce({kind:'PRESENT_UNVERIFIED',verifiedCount:0,total:2});
    await expect(f.controller.run()).resolves.toMatchObject({verifiedCount:2});
    expect(f.reserve).toHaveBeenCalledTimes(1);
    expect(f.transfer).toHaveBeenCalledTimes(2);
    expect(f.transfer.mock.calls[1][0].path).toBe(f.slots[1].path);
    expect(f.inspect).toHaveBeenCalledWith(f.reserve.mock.calls[0][0],0,undefined);
  });
  it('recovers a lost verification acknowledgement without repeating its transfer',async()=>{
    const f=fixture();
    f.verify.mockRejectedValueOnce(new Error('lost'));
    await expect(f.controller.run()).rejects.toThrow();
    f.inspect.mockResolvedValueOnce({kind:'PROGRESS',verifiedCount:1,total:2,complete:false});
    await expect(f.controller.run()).resolves.toMatchObject({verifiedCount:2});
    expect(f.transfer).toHaveBeenCalledTimes(2);
    expect(f.verify).toHaveBeenCalledTimes(2);
  });
  it('resumes only pending files after a verified prefix without rehashing or reserving',async()=>{
    const f=fixture(),abort=new AbortController();
    await expect(f.controller.run({signal:abort.signal,onProgress:p=>{
      if(p.phase==='uploading' && p.verified===1) abort.abort();
    }})).rejects.toThrow('ROLEPLAY_UPLOAD_INTERRUPTED');
    expect(f.transfer).toHaveBeenCalledTimes(1);
    expect(f.verify).toHaveBeenCalledTimes(1);
    const progress=vi.fn();
    await expect(f.controller.run({onProgress:progress})).resolves.toMatchObject({verifiedCount:2,total:2});
    expect(f.hash).toHaveBeenCalledTimes(1);
    expect(f.reserve).toHaveBeenCalledTimes(1);
    expect(f.inspect).not.toHaveBeenCalled();
    expect(f.transfer.mock.calls.map(call=>call[0].token)).toEqual(['private-token-0','private-token-1']);
    expect(f.transfer.mock.calls.map(call=>call[1].name)).toEqual(['0.mp3','1.mp3']);
    expect(progress).toHaveBeenLastCalledWith({phase:'ready',verified:2,total:2});
    await expect(f.controller.run()).resolves.toMatchObject({verifiedCount:2,total:2});
    expect(f.transfer).toHaveBeenCalledTimes(2);
  });
  it('keeps the verified prefix when a ready notification interrupts the operation',async()=>{
    const f=fixture(),abort=new AbortController();
    await expect(f.controller.run({signal:abort.signal,onProgress:p=>{
      if(p.phase==='ready') abort.abort();
    }})).rejects.toThrow('ROLEPLAY_UPLOAD_INTERRUPTED');
    const result=await f.controller.run();
    expect(result).toEqual({requestKey:f.reserve.mock.calls[0][0],verifiedCount:2,total:2});
    expect(f.hash).toHaveBeenCalledTimes(1);
    expect(f.reserve).toHaveBeenCalledTimes(1);
    expect(f.transfer).toHaveBeenCalledTimes(2);
    expect(f.verify).toHaveBeenCalledTimes(2);
    expect(f.inspect).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('private-token');
  });
  it('does not reserve again after an ambiguous reservation reply',async()=>{
    const f=fixture();f.reserve.mockRejectedValueOnce(new Error('lost'));
    await expect(f.controller.run()).rejects.toThrow();
    await expect(f.controller.run()).rejects.toThrow();
    expect(f.reserve).toHaveBeenCalledTimes(1);
    expect(f.transfer).not.toHaveBeenCalled();
  });
  it('rejects a changed signed plan before transferring bytes',async()=>{
    const f=fixture();f.slots[0].sha256='b'.repeat(64);
    await expect(f.controller.run()).rejects.toThrow();
    expect(f.transfer).not.toHaveBeenCalled();
  });
  it('stops after cancellation and checks the pending slot on retry',async()=>{
    const f=fixture(),abort=new AbortController();
    f.transfer.mockImplementationOnce(async()=>{abort.abort();return {error:null};});
    await expect(f.controller.run({signal:abort.signal})).rejects.toThrow();
    expect(f.verify).not.toHaveBeenCalled();
    f.inspect.mockResolvedValueOnce({kind:'NOT_OBSERVED',verifiedCount:0,total:2});
    await expect(f.controller.run()).resolves.toMatchObject({verifiedCount:2});
    expect(f.transfer).toHaveBeenCalledTimes(3);
  });
});
