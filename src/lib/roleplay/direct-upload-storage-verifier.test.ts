import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { verifyReservedStorageObject } from './direct-upload-storage-verifier';

vi.mock('server-only', () => ({}));
const origin = 'https://project.supabase.co';
const bytes = new Uint8Array([1,2,3,4]);
const item = { order:0, mime:'audio/mpeg', path:'staging/roleplay/123e4567-e89b-42d3-a456-426614174000/0.mp3',
  sizeBytes:bytes.length, sha256:createHash('sha256').update(bytes).digest('hex') };
const url = origin + '/storage/v1/object/sign/roleplay-audio-private/' + item.path + '?token=fixture';
function fixture() {
  const sign = vi.fn().mockResolvedValue({error:null,data:{signedUrl:url}});
  const storage = {getBucket:vi.fn().mockResolvedValue({error:null,data:{
    id:'roleplay-audio-private',name:'roleplay-audio-private',public:false,file_size_limit:15*1024*1024,
    allowed_mime_types:['audio/mpeg','audio/wav','audio/webm','audio/mp4'],
  }}),from:vi.fn(()=>({createSignedUrl:sign}))};
  const fetcher = vi.fn().mockResolvedValue(new Response(bytes));
  vi.stubGlobal('fetch',fetcher);
  return {storage,sign,fetcher};
}
afterEach(()=>vi.unstubAllGlobals());
describe('private Storage verification',()=>{
  it('hashes actual response bytes without exposing the signed URL',async()=>{
    const f=fixture();
    expect(await verifyReservedStorageObject(f.storage,origin,item)).toEqual({sizeBytes:4,sha256:item.sha256});
    expect(f.storage.from).toHaveBeenCalledWith('roleplay-audio-private');
    expect(f.sign).toHaveBeenCalledWith(item.path,120);
    expect(f.fetcher).toHaveBeenCalledWith(expect.any(URL),expect.objectContaining({redirect:'error',cache:'no-store'}));
  });
  it('rejects foreign origins and other object paths before fetching',async()=>{
    for(const signedUrl of [url.replace(origin,'https://foreign.test'),url.replace('/0.mp3','/1.mp3'),url.replace('?token=fixture','')]){
      const f=fixture();f.sign.mockResolvedValue({error:null,data:{signedUrl}});
      await expect(verifyReservedStorageObject(f.storage,origin,item)).rejects.toThrow('DIRECT_UPLOAD_OBJECT_UNVERIFIED');
      expect(f.fetcher).not.toHaveBeenCalled();
    }
  });
  it('rejects changed bytes, partial responses and declared size mismatches',async()=>{
    for(const response of [new Response(new Uint8Array([4,3,2,1])),new Response(bytes,{status:206}),new Response(bytes,{headers:{'content-length':'99'}})]){
      const f=fixture();f.fetcher.mockResolvedValue(response);
      await expect(verifyReservedStorageObject(f.storage,origin,item)).rejects.toThrow('DIRECT_UPLOAD_OBJECT_UNVERIFIED');
    }
  });
});
