import { ROLEPLAY_STUDIO_PACKAGE_MAX_SCENARIOS, ROLEPLAY_STUDIO_PACKAGE_MAX_AUDIO_SECONDS, ROLEPLAY_ADMIN_AUDIO_MAX_BYTES, ROLEPLAY_RESPONSE_MAX_DURATION_SEC } from '@/lib/roleplay-limits';
import { STUDIO_HANDOFF_MAX_BYTES } from './assignment-handoff';
import { validStudioRanges } from './compound-cuts';
import { STUDIO_MAX_EDITOR_SEGMENTS, type StudioDraftSegment } from './draft';
import type { StudioPublicationPart } from './publication-parts';

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

type WavHeader = ReturnType<typeof readHeader>;
async function inspectSource(source: File): Promise<WavHeader> {
  if (!/\.wav$/i.test(source.name) || source.size < HEADER || source.size > 0xffffffff+8) {
    throw new Error('Selecciona un WAV PCM compatible.');
  }
  return readHeader(await source.slice(0,HEADER).arrayBuffer(),source.size);
}
function manifestEntry(turn: StudioDraftSegment, index: number, size: number, sha256: string) {
  return {
    order:index, title:turn.title, file:'segment-'+String(index+1).padStart(2,'0')+'.wav',
    size_bytes:size, sha256, duration_limit_sec:turn.responseLimit, script_prompt:turn.scriptPrompt,
    studio_turn:index+1,
    ...(turn.language==='en'||turn.language==='es'?{studio_language:turn.language}:{}),
    ...(!turn.ranges && turn.end<=7200?{source_start_sec:turn.start,source_end_sec:turn.end}:{}),
  };
}
function manifestText(entries: ReturnType<typeof manifestEntry>[]) {
  return JSON.stringify({version:1,generator:'interpretes-rd-local-wav',segments:entries});
}
function manifestBytes(entries: ReturnType<typeof manifestEntry>[]) {
  return new TextEncoder().encode(manifestText(entries)).byteLength;
}
function inspectTurn(turn: StudioDraftSegment, source: WavHeader, lastEnd: number) {
  const {frames, rate, alignment}=source;
  const ranges=validStudioRanges(turn,frames/rate);
  if (!ranges || turn.start<lastEnd || turn.end>frames/rate || turn.speakerRole==='interpreter' ||
      !turn.title.trim() || turn.title.length>200 || turn.scriptPrompt.length>5000 ||
      !Number.isInteger(turn.responseLimit) || turn.responseLimit<0 || turn.responseLimit>ROLEPLAY_RESPONSE_MAX_DURATION_SEC)
    throw new Error('Revisa los cortes, títulos, instrucciones y límites antes de preparar el audio local.');
  const slices=ranges.map(range=>({start:Math.round(range.start*rate),end:Math.round(range.end*rate)}));
  const count=slices.reduce((n,r)=>n+r.end-r.start,0);
  const bytes=count*alignment;
  if (slices.some(r=>r.end<=r.start || r.end>frames) || bytes+HEADER>ROLEPLAY_ADMIN_AUDIO_MAX_BYTES)
    throw new Error('Un corte supera 15 MiB o tiene muestras inválidas. Divídelo antes de preparar las partes.');
  return {slices,count,bytes};
}
export type LocalWavPart<T> = StudioPublicationPart<T> & { bytes: number };
/** Reads only 44 bytes; sizes include WAV headers and exact UTF-8 manifest
 * size (SHA-256 is always 64 ASCII characters). Never creates audio files. */
export async function planLocalWavParts<T extends StudioDraftSegment & {id:string}>(
  source: File, turns: readonly T[], signal: AbortSignal,
): Promise<LocalWavPart<T>[]> {
  signal.throwIfAborted();
  if (!turns.length || turns.length>STUDIO_MAX_EDITOR_SEGMENTS) throw new Error('Cantidad de intervenciones no válida.');
  const info=await inspectSource(source);
  signal.throwIfAborted();
  const parts:LocalWavPart<T>[]=[];
  let selected:T[]=[], entries:ReturnType<typeof manifestEntry>[]=[], frames=0, bytes=0, lastEnd=0, first=1;
  const flush=()=>{
    if (!selected.length)return;
    parts.push({key:JSON.stringify(selected.map(turn=>turn.id)),number:parts.length+1,first,
      last:first+selected.length-1,seconds:frames/info.rate,turns:selected,bytes:bytes+manifestBytes(entries)});
    first+=selected.length;selected=[];entries=[];frames=0;bytes=0;
  };
  for(const [index,turn] of [...turns].sort((a,b)=>a.start-b.start).entries()){
    signal.throwIfAborted();
    let cut:ReturnType<typeof inspectTurn>;
    try {cut=inspectTurn(turn,info,lastEnd);}
    catch(cause){throw new Error('Intervención '+(index+1)+': '+(cause instanceof Error?cause.message:'Corte inválido.'));}
    lastEnd=turn.end;
    const size=cut.bytes+HEADER;
    let entry=manifestEntry(turn,selected.length,size,'0'.repeat(64));
    if(selected.length>=ROLEPLAY_STUDIO_PACKAGE_MAX_SCENARIOS || frames+cut.count>ROLEPLAY_STUDIO_PACKAGE_MAX_AUDIO_SECONDS*info.rate ||
      bytes+size+manifestBytes([...entries,entry])>STUDIO_HANDOFF_MAX_BYTES){
      flush();
      entry=manifestEntry(turn,0,size,'0'.repeat(64));
    }
    if(size+manifestBytes([entry])>STUDIO_HANDOFF_MAX_BYTES)throw new Error('Intervención '+(index+1)+' supera el presupuesto de transferencia.');
    selected.push(turn);entries.push(entry);frames+=cut.count;bytes+=size;
  }
  flush();
  return parts;
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
  const info=await inspectSource(source);
  const {view,rate,alignment}=info;
  signal.throwIfAborted();
  let lastEnd=0, totalFrames=0, totalBytes=0;
  const plans = [...turns].sort((a,b)=>a.start-b.start).map(turn=>{
    const {slices,count,bytes}=inspectTurn(turn,info,lastEnd);
    lastEnd=turn.end;
    totalFrames+=count;totalBytes+=bytes+HEADER;
    return {turn,slices,bytes};
  });
  const predicted=manifestBytes(plans.map(({turn,bytes},index)=>manifestEntry(turn,index,bytes+HEADER,'0'.repeat(64))));
  if(totalFrames>ROLEPLAY_STUDIO_PACKAGE_MAX_AUDIO_SECONDS*rate || totalBytes+predicted>STUDIO_HANDOFF_MAX_BYTES)
    throw new Error('Los cortes superan el presupuesto local de 16 MiB por transferencia o 15 minutos. Prepara una parte más pequeña.');
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
    entries.push(manifestEntry(turn,index,file.size,Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')));
    onProgress(index+1,plans.length);
  }
  const manifest=new File([manifestText(entries)],'manifest.json',{type:'application/json'});
  if(totalBytes+manifest.size>STUDIO_HANDOFF_MAX_BYTES)throw new Error('El paquete local supera 16 MiB.');
  return [manifest,...files];
}
