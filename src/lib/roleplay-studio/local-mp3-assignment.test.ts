// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { canPrepareLocalMp3, encodeStudioPcm16, LOCAL_MP3_PCM_RATE } from './local-mp3-assignment';
describe('short local MP3 conversion bounds',()=>{
  it('admits only short MP3 within existing input budget',()=>{
    expect(canPrepareLocalMp3({name:'a.mp3',size:8*1024*1024},120)).toBe(true);
    expect(canPrepareLocalMp3({name:'a.mp3',size:8*1024*1024+1},120)).toBe(false);
    expect(canPrepareLocalMp3({name:'a.mp3',size:1},121)).toBe(false);
    expect(canPrepareLocalMp3({name:'a.mp4',size:1},1)).toBe(false);
  });
  it('writes canonical PCM16 header, preserves stereo channel order and clips out-of-range samples',()=>{
    const samples=[new Float32Array([-1,0.5]),new Float32Array([1.5,0])];
    const decoded={length:2,sampleRate:LOCAL_MP3_PCM_RATE,numberOfChannels:2,getChannelData:(i:number)=>samples[i]};
    const result=new DataView(encodeStudioPcm16(decoded));
    expect(result.byteLength).toBe(52);
    expect(result.getUint16(22,true)).toBe(2);
    expect(result.getUint32(24,true)).toBe(24000);
    expect(result.getUint32(40,true)).toBe(8);
    expect([44,46,48,50].map(i=>result.getInt16(i,true))).toEqual([-32768,32767,16384,0]);
    expect(()=>encodeStudioPcm16({...decoded,length:120*24000+1})).toThrow();
    expect(()=>encodeStudioPcm16({...decoded,numberOfChannels:3})).toThrow();
    expect(()=>encodeStudioPcm16({...decoded,sampleRate:48000})).toThrow();
  });
});
