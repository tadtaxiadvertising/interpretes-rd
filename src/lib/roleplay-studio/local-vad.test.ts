import { describe, expect, it } from 'vitest';
import { detectLocalSpeech } from './local-vad';

function signal(sampleRate:number, seconds:number, active:Array<[number,number]>):Float32Array {
  const data=new Float32Array(Math.floor(sampleRate*seconds));
  for(const [start,end] of active) for(let i=Math.floor(start*sampleRate);i<Math.min(data.length,Math.floor(end*sampleRate));i++) {
    data[i]=0.18*Math.sin(2*Math.PI*220*i/sampleRate);
  }
  return data;
}
describe('local VAD',()=>{
  it('detects speech-like energy and applies bounded padding',()=>{
    const sr=16000, data=signal(sr,5,[[1,2],[3,4]]);
    const result=detectLocalSpeech([data],sr);
    expect(result).toHaveLength(2);
    expect(result[0].start).toBeLessThanOrEqual(1);
    expect(result[0].end).toBeGreaterThanOrEqual(2);
    expect(result[1].start).toBeGreaterThanOrEqual(2.8);
  });
  it('returns no false segments for silence or invalid channels',()=>{
    expect(detectLocalSpeech([new Float32Array(16000*3)],16000)).toEqual([]);
    expect(detectLocalSpeech([],16000)).toEqual([]);
    expect(detectLocalSpeech([new Float32Array(100),new Float32Array(99)],16000)).toEqual([]);
  });
  it('supports stereo inputs without claiming speaker identity',()=>{
    const left=signal(16000,3,[[0.5,1.5]]);
    const right=signal(16000,3,[[1.7,2.6]]);
    expect(detectLocalSpeech([left,right],16000).length).toBe(2);
  });
});
