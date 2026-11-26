// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe,expect,it,vi } from 'vitest';
import { decodedClinicalDuration,verifyDecodedClinicalAudio } from './direct-upload-audio-decoder';
vi.mock('server-only',()=>({}));
function wav(seconds:number) {
  const rate=8000, samples=rate*seconds, b=Buffer.alloc(44+samples*2);
  b.write('RIFF',0); b.writeUInt32LE(b.length-8,4); b.write('WAVEfmt ',8);
  b.writeUInt32LE(16,16); b.writeUInt16LE(1,20); b.writeUInt16LE(1,22);
  b.writeUInt32LE(rate,24); b.writeUInt32LE(rate*2,28);
  b.writeUInt16LE(2,32); b.writeUInt16LE(16,34);
  b.write('data',36); b.writeUInt32LE(samples*2,40);
  return b;
}
function input(bytes:Buffer,mime='audio/wav'){
  return {stream:new Response(new Uint8Array(bytes)).body!,item:{mime,sizeBytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}};
}
describe('final clinical audio decoder',()=>{
  it('requires complete nonzero decoded duration within pilot limit',()=>{
    expect(decodedClinicalDuration('out_time_us=1000000\nprogress=end\n')).toBe(1);
    for(const bad of ['out_time_us=0\nprogress=end\n','out_time_us=300000001\nprogress=end\n','out_time_us=1000000\nprogress=continue\n']) expect(()=>decodedClinicalDuration(bad)).toThrow();
  });
  it('decodes a real synthetic WAV with exact bytes and digest',async()=>{
    const f=input(wav(1));
    expect(await verifyDecodedClinicalAudio(f.stream,f.item)).toEqual({sizeBytes:f.item.sizeBytes,sha256:f.item.sha256});
  },60_000);
  it('rejects matching hashes for corrupt data or an incorrect declared container',async()=>{
    for(const f of [input(Buffer.from('not audio')),input(wav(1),'audio/mpeg')])
      await expect(verifyDecodedClinicalAudio(f.stream,f.item)).rejects.toThrow('FINAL_AUDIO_DECODE_UNAVAILABLE');
  },60_000);
  it('rejects a valid but overlength recording rather than silently truncating',async()=>{
    const f=input(wav(302));
    await expect(verifyDecodedClinicalAudio(f.stream,f.item)).rejects.toThrow('FINAL_AUDIO_DECODE_UNAVAILABLE');
  },60_000);
  it('rejects a digest mismatch and a cancelled request',async()=>{
    const f=input(wav(1));
    await expect(verifyDecodedClinicalAudio(f.stream,{...f.item,sha256:'a'.repeat(64)})).rejects.toThrow();
    const g=input(wav(1)),abort=new AbortController();
    abort.abort();
    await expect(verifyDecodedClinicalAudio(g.stream,g.item,undefined,abort.signal)).rejects.toThrow();
  });
});
