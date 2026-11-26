import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createFinalClinicalStoragePort } from './direct-upload-final-storage';
vi.mock('server-only', () => ({}));
const origin = 'https://project.supabase.co';
const batch = '123e4567-e89b-42d3-a456-426614174000';
const bytes = new Uint8Array([1,2,3,4]);
const item = {order:0,mime:'audio/mpeg',sizeBytes:4,sha256:createHash('sha256').update(bytes).digest('hex'),path:'staging/roleplay/'+batch+'/0.mp3'};
const destination = 'base/'+batch+'/0.mp3';
function fixture() {
  const sign = vi.fn(async(path:string)=>({error:null,data:{signedUrl:origin+'/storage/v1/object/sign/roleplay-audio-private/'+path+'?token=fixture'}}));
  const upload = vi.fn().mockResolvedValue({error:null,data:{path:destination}});
  const getBucket = vi.fn().mockResolvedValue({error:null,data:{
    id:'roleplay-audio-private',name:'roleplay-audio-private',public:false,file_size_limit:15*1024*1024,
    allowed_mime_types:['audio/mpeg','audio/wav','audio/webm','audio/mp4'],
  }});
  const exists = vi.fn().mockResolvedValue({data:false,error:null});
  const storage = {getBucket,from:vi.fn(()=>({createSignedUrl:sign,upload,exists}))};
  const fetcher = vi.fn(async()=>new Response(bytes));
  vi.stubGlobal('fetch',fetcher);
  return {port:createFinalClinicalStoragePort(storage,origin),sign,upload,getBucket,fetcher,storage,exists};
}
afterEach(()=>vi.unstubAllGlobals());
describe('final clinical Storage adapter',()=>{
  it('validates source bytes before uploading a new immutable destination',async()=>{
    const f=fixture();
    await f.port.copyIfAbsent(item,destination);
    expect(f.upload).toHaveBeenCalledExactlyOnceWith(destination,bytes,{upsert:false,contentType:'audio/mpeg',cacheControl:'0'});
    expect(f.sign).toHaveBeenCalledWith(item.path,120);
    expect(f.storage.from.mock.calls).toEqual([['roleplay-audio-private'],['roleplay-audio-private'],['roleplay-audio-private']]);
    expect(await f.port.verify({...item,path:destination})).toEqual({sizeBytes:4,sha256:item.sha256});
    expect(f.sign).toHaveBeenLastCalledWith(destination,120);
  });
  it('refuses cross-batch destinations, malformed paths and oversized declarations before network access',async()=>{
    const f=fixture();
    for(const [source,target] of [[item,destination.replace('/0.mp3','/1.mp3')],[{...item,path:item.path+'\n'},destination],[{...item,sizeBytes:15*1024*1024+1},destination]] as const) {
      await expect(f.port.copyIfAbsent(source,target)).rejects.toThrow('INVALID_FINAL_OBJECT');
    }
    expect(f.sign).not.toHaveBeenCalled();
    expect(f.upload).not.toHaveBeenCalled();
  });
  it('rejects corrupt or excess source bytes without writing',async()=>{
    const f=fixture();
    for(const bad of [new Uint8Array([4,3,2,1]),new Uint8Array(5),new Uint8Array(3)]) {
      f.fetcher.mockResolvedValueOnce(new Response(bad));
      await expect(f.port.copyIfAbsent(item,destination)).rejects.toThrow('FINAL_STORAGE_UNAVAILABLE');
    }
    expect(f.upload).not.toHaveBeenCalled();
  });
  it('skips the source transfer for an observed final object and still permits independent verification',async()=>{
    const f=fixture();
    f.exists.mockResolvedValueOnce({data:true,error:null});
    await f.port.copyIfAbsent(item,destination);
    expect(f.exists).toHaveBeenCalledWith(destination);
    expect(f.upload).not.toHaveBeenCalled();
    expect(f.sign).not.toHaveBeenCalled();
    expect(await f.port.verify({...item,path:destination})).toEqual({sizeBytes:4,sha256:item.sha256});
    expect(f.sign).toHaveBeenCalledExactlyOnceWith(destination,120);
  });
  it('does not treat a provider failure as a missing destination',async()=>{
    const f=fixture();
    f.exists.mockResolvedValueOnce({data:false,error:{message:'denied'}});
    await expect(f.port.copyIfAbsent(item,destination)).rejects.toThrow('FINAL_STORAGE_UNAVAILABLE');
    expect(f.sign).not.toHaveBeenCalled();
    expect(f.upload).not.toHaveBeenCalled();
  });
  it('does not overwrite an existing destination or retry an uncertain upload',async()=>{
    const f=fixture();
    f.upload.mockResolvedValueOnce({error:{message:'already exists'},data:null});
    await expect(f.port.copyIfAbsent(item,destination)).rejects.toThrow('FINAL_STORAGE_UNAVAILABLE');
    expect(f.upload).toHaveBeenCalledTimes(1);
    expect(f.upload.mock.calls[0][2]).toMatchObject({upsert:false});
  });
});
