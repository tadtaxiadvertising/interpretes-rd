export type LocalVadSegment = { start: number; end: number; confidence: number };
export type LocalVadOptions = {
  thresholdRms?: number;
  minSilenceDurationSec?: number;
  minSpeechDurationSec?: number;
  preRollSec?: number;
  postRollSec?: number;
};
const clamp = (n:number,lo:number,hi:number) => Math.min(hi,Math.max(lo,n));

/** Pure mono/stereo VAD. It detects speech-like energy only; it does not identify speakers or language. */
export function detectLocalSpeech(
  channels: readonly Float32Array[], sampleRate: number, options: LocalVadOptions = {},
): LocalVadSegment[] {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000 ||
      channels.length < 1 || channels.length > 2 || channels.some(c => !(c instanceof Float32Array))) return [];
  const length = channels[0].length;
  if (!length || channels.some(c => c.length !== length)) return [];
  const frame = Math.max(1, Math.floor(sampleRate * 0.025));
  const frameCount = Math.ceil(length / frame);
  const rms = new Float32Array(frameCount);
  let max = 0, sum = 0;
  for (let f=0; f<frameCount; f++) {
    const from=f*frame, to=Math.min(length,from+frame);
    let energy=0, count=0;
    for(let i=from;i<to;i+=4) {
      let sample=0;
      for(const channel of channels) sample=Math.max(sample,Math.abs(channel[i] || 0));
      energy+=sample*sample; count++;
    }
    const value=count?Math.sqrt(energy/count):0;
    rms[f]=value; max=Math.max(max,value); sum+=value;
  }
  const mean=sum/frameCount;
  const adaptive=clamp(mean*0.75+max*0.10,0.006,0.035);
  const threshold=Number.isFinite(options.thresholdRms) && (options.thresholdRms??0)>0
    ? clamp(options.thresholdRms!,0.001,0.2) : (max<=0.005?0.005:adaptive);
  const minSilence=Math.max(1,Math.ceil(clamp(options.minSilenceDurationSec??0.4,0.1,3)*sampleRate/frame));
  const minSpeech=Math.max(1,Math.ceil(clamp(options.minSpeechDurationSec??0.5,0.1,10)*sampleRate/frame));
  const pre=Math.round(clamp(options.preRollSec??0.15,0,1)*sampleRate);
  const post=Math.round(clamp(options.postRollSec??0.2,0,1)*sampleRate);
  const ranges:Array<{start:number;end:number}>=[];
  let start=-1, silence=0;
  for(let f=0;f<frameCount;f++) {
    if(rms[f]>=threshold) {
      if(start<0) start=f;
      silence=0;
    } else if(start>=0) {
      silence++;
      if(silence>=minSilence) {
        const end=f-silence+1;
        if(end-start>=minSpeech) ranges.push({start,end});
        start=-1; silence=0;
      }
    }
  }
  if(start>=0) {
    const end=frameCount-silence;
    if(end-start>=minSpeech) ranges.push({start,end});
  }
  const totalSeconds=length/sampleRate;
  return ranges.slice(0,100).map(range=>{
    const startSample=Math.max(0,range.start*frame-pre);
    const endSample=Math.min(length,range.end*frame+post);
    return {
      start:Number((startSample/sampleRate).toFixed(3)),
      end:Number((endSample/sampleRate).toFixed(3)),
      confidence:Number(clamp(rms.slice(range.start,range.end).reduce((a,b)=>a+b,0)/
        Math.max(1,range.end-range.start)/(threshold*2),0,1).toFixed(3)),
    };
  }).filter(s=>s.end>s.start && s.end<=totalSeconds);
}
