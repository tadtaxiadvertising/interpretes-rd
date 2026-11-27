import { withStudioDecodeSlot } from './decode-slot';

export const LOCAL_MP3_MAX_BYTES = 8 * 1024 * 1024;
export const LOCAL_MP3_MAX_SECONDS = 120;
export const LOCAL_MP3_PCM_RATE = 24000;
export function canPrepareLocalMp3(file: Pick<File,'name'|'size'>, duration: number) {
  return /\.mp3$/i.test(file.name) && file.size>0 && file.size<=LOCAL_MP3_MAX_BYTES &&
    Number.isFinite(duration) && duration>0 && duration<=LOCAL_MP3_MAX_SECONDS;
}

/** PCM16 with bounded allocation; preserve channels, no gain or silence removal. */
export function encodeStudioPcm16(decoded: Pick<AudioBuffer,'length'|'sampleRate'|'numberOfChannels'|'getChannelData'>): ArrayBuffer {
  const {length, sampleRate, numberOfChannels:channels}=decoded;
  if(sampleRate!==LOCAL_MP3_PCM_RATE || !Number.isInteger(length) || length<1 ||
     length>LOCAL_MP3_MAX_SECONDS*sampleRate || ![1,2].includes(channels))throw new Error('El audio decodificado supera los límites locales.');
  const dataBytes=length*channels*2;
  const buffer=new ArrayBuffer(44+dataBytes), view=new DataView(buffer);
  for(const [at,word] of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']] as const)
    for(let i=0;i<4;i++)view.setUint8(at+i,word.charCodeAt(i));
  view.setUint32(4,36+dataBytes,true);view.setUint32(16,16,true);view.setUint16(20,1,true);
  view.setUint16(22,channels,true);view.setUint32(24,sampleRate,true);
  view.setUint32(28,sampleRate*channels*2,true);view.setUint16(32,channels*2,true);
  view.setUint16(34,16,true);view.setUint32(40,dataBytes,true);
  const samples=Array.from({length:channels},(_,i)=>decoded.getChannelData(i));
  if(samples.some(channel=>channel.length!==length))throw new Error('Canales PCM inválidos.');
  for(let i=0;i<length;i++)for(let c=0;c<channels;c++){
    const value=samples[c][i];
    if(!Number.isFinite(value))throw new Error('Muestra PCM inválida.');
    const clamped=Math.max(-1,Math.min(1,value));
    view.setInt16(44+(i*channels+c)*2,Math.round(clamped*(clamped<0?32768:32767)),true);
  }
  return buffer;
}

/** Explicit short-source conversion. Browser decoder may allocate additional
 * internal buffers; these bounds are admission checks, not a peak RAM promise. */
export async function decodeLocalMp3ForAssignment(source: File, duration: number, signal: AbortSignal): Promise<File> {
  signal.throwIfAborted();
  if(!canPrepareLocalMp3(source,duration))throw new Error('MP3 local: máximo 2 minutos y 8 MiB.');
  if(typeof OfflineAudioContext!=='function')throw new Error('Este navegador no admite la conversión local. Usa el exportador habitual.');
  return withStudioDecodeSlot(signal, async () => {
  const context=new OfflineAudioContext(2,1,LOCAL_MP3_PCM_RATE);
  const bytes=await source.arrayBuffer();
  signal.throwIfAborted();
  const decoded=await context.decodeAudioData(bytes);
  signal.throwIfAborted();
  if(!Number.isFinite(decoded.duration)||Math.abs(decoded.duration-duration)>0.25)
    throw new Error('La duración decodificada no coincide con la grabación. No se ajustarán los cortes automáticamente.');
  const wav=encodeStudioPcm16(decoded);
  signal.throwIfAborted();
  return new File([wav],'studio-local-converted.wav',{type:'audio/wav'});
  });
}
