import { ROLEPLAY_STUDIO_PACKAGE_MAX_SCENARIOS, ROLEPLAY_STUDIO_PACKAGE_MAX_AUDIO_SECONDS, ROLEPLAY_ADMIN_AUDIO_MAX_BYTES, ROLEPLAY_RESPONSE_MAX_DURATION_SEC } from '@/lib/roleplay-limits';
import { STUDIO_HANDOFF_MAX_BYTES } from './assignment-handoff';
import { validStudioRanges } from './compound-cuts';
import type { StudioDraftSegment } from './draft';

const HEADER = 44;
const tag = (view: DataView, offset: number) => String.fromCharCode(...Array.from({length:4}, (_, i) => view.getUint8(offset+i)));
function readHeader(bytes: ArrayBuffer, size: number) {
  if (bytes.byteLength !== HEADER) throw new Error('WAV incompleto.');
  const view = new DataView(bytes);
  const channels = view.getUint16(22,true), rate = view.getUint32(24,true), alignment = view.getUint16(32,true);
  const dataBytes = view.getUint32(40,true);
  if (tag(view,0)!=='RIFF' || tag(view,8)!=='WAVE' || tag(view,12)!=='fmt ' || tag(view,36)!=='data' ||
      view.getUint32(16,true)!==16 || view.getUint16(20,true)!==1 || view.getUint16(34,true)!==16 ||
      ![1,2].includes(channels) || rate<8000 || rate>48000 || alignment!==channels*2 ||
      view.getUint32(28,true)!==rate*alignment || dataBytes===0 || dataBytes%alignment!==0 ||
      dataBytes+HEADER!==size || view.getUint32(4,true)!==size-8) {
    throw new Error('Se requiere WAV PCM de 16 bits, mono o estéreo, 8–48 kHz y cabecera estándar. Usa el exportador local para otros formatos.');
  }
  return { view, rate, alignment, frames: dataBytes/alignment };
}

/** No decoding or transcoding: copy only selected PCM frames, preserving rate/channels.
 * The source is never read wholesale. All limits are checked before copying. */
export async function prepareLocalWavAssignment(
  source: File, turns: readonly StudioDraftSegment[], signal: AbortSignal,
  onProgress: (done:number,total:number)=>void = () => {},
): Promise<File[]> {
  signal.throwIfAborted();
  if (!/\.wav$/i.test(source.name) || source.size<HEADER || source.size>0xffffffff+8 ||
      turns.length<1 || turns.length>ROLEPLAY_STUDIO_PACKAGE_MAX_SCENARIOS) throw new Error('Selecciona un WAV y una parte de hasta 25 intervenciones.');
  const {view,rate,alignment,frames} = readHeader(await source.slice(0,HEADER).arrayBuffer(),source.size);
  signal.throwIfAborted();
  let lastEnd=0, totalFrames=0, totalBytes=0;
  const plans = [...turns].sort((a,b)=>a.start-b.start).map(turn=>{
    const ranges=validStudioRanges(turn,frames/rate);
    if (!ranges || turn.start<lastEnd || turn.end>frames/rate || turn.speakerRole==='interpreter' ||
        !turn.title.trim() || turn.title.length>200 || turn.scriptPrompt.length>5000 ||
        !Number.isInteger(turn.responseLimit) || turn.responseLimit<0 || turn.responseLimit>ROLEPLAY_RESPONSE_MAX_DURATION_SEC)
      throw new Error('Revisa los cortes, títulos, instrucciones y límites antes de preparar el audio local.');
    lastEnd=turn.end;
    const slices=ranges.map(range=>({start:Math.round(range.start*rate),end:Math.round(range.end*rate)}));
    const count=slices.reduce((n,r)=>n+r.end-r.start,0);
    const bytes=count*alignment;
    totalFrames+=count; totalBytes+=bytes+HEADER;
    if (slices.some(r=>r.end<=r.start || r.end>frames) || bytes+HEADER>ROLEPLAY_ADMIN_AUDIO_MAX_BYTES ||
        totalFrames>ROLEPLAY_STUDIO_PACKAGE_MAX_AUDIO_SECONDS*rate || totalBytes>STUDIO_HANDOFF_MAX_BYTES)
      throw new Error('Los cortes superan el presupuesto local de 16 MiB por transferencia, 15 MiB por audio o 15 minutos. Prepara una parte más pequeña.');
    return {turn,slices,bytes};
  });
  const files:File[]=[];
  const entries=[];
  for(const [index,{turn,slices,bytes}] of plans.entries()){
    signal.throwIfAborted();
    const header=new ArrayBuffer(HEADER);
    new Uint8Array(header).set(new Uint8Array(view.buffer,view.byteOffset,HEADER));
    const out=new DataView(header);
    out.setUint32(4,bytes+36,true);out.setUint32(40,bytes,true);
    const pieces=slices.map(r=>source.slice(HEADER+r.start*alignment,HEADER+r.end*alignment));
    const file=new File([header,...pieces], 'segment-'+String(index+1).padStart(2,'0')+'.wav',{type:'audio/wav'});
    const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
    signal.throwIfAborted();
    files.push(file);
    entries.push({
      order:index, title:turn.title, file:file.name, size_bytes:file.size,
      sha256:Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join(''),
      duration_limit_sec:turn.responseLimit, script_prompt:turn.scriptPrompt,
      studio_turn:index+1,
      ...(turn.language==='en'||turn.language==='es'?{studio_language:turn.language}:{}),
      ...(!turn.ranges && turn.end<=7200?{source_start_sec:turn.start,source_end_sec:turn.end}:{}),
    });
    onProgress(index+1,plans.length);
  }
  const manifest=new File([JSON.stringify({version:1,generator:'interpretes-rd-local-wav',segments:entries})],'manifest.json',{type:'application/json'});
  if(totalBytes+manifest.size>STUDIO_HANDOFF_MAX_BYTES)throw new Error('El paquete local supera 16 MiB.');
  return [manifest,...files];
}
