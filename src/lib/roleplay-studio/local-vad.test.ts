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
  it('combines stereo acoustic activity when the inter-channel pause is below the silence threshold',()=>{
    const left=signal(16000,3,[[0.5,1.5]]);
    const right=signal(16000,3,[[1.7,2.6]]);
    // The default minimum silence is 0.4 s, so a 0.2 s pause must
    // not split the detected turn. Channels do not imply speakers.
    const result=detectLocalSpeech([left,right],16000);
    expect(result).toHaveLength(1);
    expect(result[0].start).toBeLessThanOrEqual(0.5);
    expect(result[0].end).toBeGreaterThanOrEqual(2.6);
  });
  it('splits stereo acoustic activity after a silence longer than the configured threshold',()=>{
    const left=signal(16000,4,[[0.4,1.3]]);
    const right=signal(16000,4,[[2,3]]);
    const result=detectLocalSpeech([left,right],16000);
    expect(result).toHaveLength(2);
    expect(result[0].start).toBeLessThanOrEqual(0.4);
    expect(result[1].start).toBeGreaterThanOrEqual(1.8);
  });
  it('can split shorter pauses when the silence threshold is explicitly lowered',()=>{
    const left=signal(16000,3,[[0.5,1.5]]);
    const right=signal(16000,3,[[1.7,2.6]]);
    const result=detectLocalSpeech([left,right],16000,{ minSilenceDurationSec: 0.1 });
    expect(result).toHaveLength(2);
  });

  it.each([16000, 44100, 48000])('keeps short-pause padding disjoint without trimming acoustic intervals at %i Hz', sr=>{
    const data=signal(sr,4,[[0.5,1.2],[1.4,2.3]]);
    const raw=detectLocalSpeech([data],sr,{ minSilenceDurationSec: 0.1, preRollSec: 0, postRollSec: 0 });
    expect(raw).toHaveLength(2);
    for (const padding of [{}, { preRollSec: 1, postRollSec: 0 }, { preRollSec: 0, postRollSec: 1 }, { preRollSec: 1, postRollSec: 1 }]) {
      const result=detectLocalSpeech([data],sr,{ minSilenceDurationSec: 0.1, ...padding });
      expect(result).toHaveLength(2);
      expect(result[0].end).toBeLessThanOrEqual(result[1].start);
      for (let i=0;i<2;i++) {
        expect(result[i].start).toBeLessThanOrEqual(raw[i].start);
        expect(result[i].end).toBeGreaterThanOrEqual(raw[i].end);
        expect(result[i].signalLevel).toBe(raw[i].signalLevel);
      }
    }
  });

  it.each([16000, 44100, 48000])('keeps existing padding when the silence is long enough at %i Hz', sr=>{
    const result=detectLocalSpeech([signal(sr,5,[[1,2],[3,4]])],sr);
    expect(result).toHaveLength(2);
    expect(result[0].start).toBeCloseTo(0.85,1);
    expect(result[0].end).toBeCloseTo(2.2,1);
    expect(result[1].start).toBeCloseTo(2.85,1);
    expect(result[1].end).toBeCloseTo(4.2,1);
  });

  it('honors an explicit RMS threshold and minimum speech duration',()=>{
    const short=signal(16000,2,[[0.5,0.8]]);
    expect(detectLocalSpeech([short],16000,{ thresholdRms: 0.05, minSpeechDurationSec: 0.5 })).toEqual([]);
    const result=detectLocalSpeech([short],16000,{ thresholdRms: 0.05, minSpeechDurationSec: 0.1 });
    expect(result).toHaveLength(1);
  });
  it('rejects sample rates outside the supported range',()=>{
    const data=new Float32Array(16000);
    expect(detectLocalSpeech([data],7999)).toEqual([]);
    expect(detectLocalSpeech([data],192001)).toEqual([]);
  });
  it('never pads a segment beyond the source duration',()=>{
    const data=signal(16000,1,[[0.7,1]]);
    const result=detectLocalSpeech([data],16000,{ postRollSec: 1, minSpeechDurationSec: 0.1 });
    expect(result).toHaveLength(1);
    expect(result[0].end).toBeLessThanOrEqual(1);
    expect(result[0].end).toBe(1);
  });
  it.each([16000, 44100, 48000])('preserves the last segment when rounding EOF up at %i Hz', sr=>{
    // End is slightly past 1.0005s, so rounding to milliseconds would
    // otherwise place the segment outside the source and discard it.
    const data=new Float32Array(sr+Math.ceil(sr*0.0006));
    for(let i=Math.floor(sr*0.2);i<data.length;i++) {
      data[i]=0.18*Math.sin(2*Math.PI*220*i/sr);
    }
    const result=detectLocalSpeech([data],sr,{postRollSec:1});
    expect(result).toHaveLength(1);
    expect(result[0].end).toBe(data.length/sr);
    expect(result[0].start).toBeLessThan(result[0].end);
  });
  it('does not count pre/post-roll as detected speech duration',()=>{
    const data=signal(16000,1,[[0.7,1]]);
    // Padding must not make a sub-threshold acoustic interval eligible.
    expect(detectLocalSpeech([data],16000,{ preRollSec: 1, postRollSec: 1 }))
      .toEqual([]);
  });
});
