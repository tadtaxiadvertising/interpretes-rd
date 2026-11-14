'use client';
import { useState } from 'react';
import { detectLocalSpeech, type LocalVadSegment } from '@/lib/roleplay-studio/local-vad';

export default function LocalVadAssistant({file,duration,remaining,onApply}:{file:File;duration:number;remaining:number;onApply:(segments:LocalVadSegment[])=>void}) {
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [found,setFound]=useState<LocalVadSegment[]>([]);
  const analyze=async()=>{
    if(busy||remaining<1)return;
    setBusy(true);setError('');setFound([]);
    let context:AudioContext|null=null;
    try {
      if(typeof window.AudioContext!=='function') throw new Error('Este navegador no permite analizar audio localmente.');
      if(!Number.isFinite(duration)||duration<=0||duration>240) throw new Error('El audio debe durar entre 0 y 4 minutos para el análisis local.');
      if(file.size<1||file.size>15*1024*1024) throw new Error('El MP3 debe pesar hasta 15 MiB.');
      // The parent audio element has already loaded MP3 metadata. Reject
      // oversized duration *before* allocating decoded PCM in AudioContext.
      if(!Number.isFinite(duration)||duration<=0) throw new Error('Espera a que se cargue la duración del MP3.');
      if(duration>240) throw new Error('Para proteger la memoria del navegador, el VAD local admite audios de hasta 4 minutos.');
      context=new AudioContext();
      const decoded=await context.decodeAudioData((await file.arrayBuffer()).slice(0));
      if(decoded.duration>240) throw new Error('Para proteger la memoria del navegador, el VAD local admite audios de hasta 4 minutos.');
      const channels=[decoded.getChannelData(0)];
      if(decoded.numberOfChannels>1) channels.push(decoded.getChannelData(1));
      const segments=detectLocalSpeech(channels,decoded.sampleRate);
      if(!segments.length) throw new Error('No se detectaron intervenciones con suficiente energía. Ajusta manualmente los cortes o usa subtítulos temporizados.');
      setFound(segments.slice(0,remaining));
      if(segments.length>remaining) setError('Se muestran los primeros '+remaining+' cortes por el límite de escenarios.');
    } catch(cause) {
      setError(cause instanceof Error?cause.message:'No se pudo analizar el audio.');
    } finally {
      if(context) await context.close().catch(()=>{});
      setBusy(false);
    }
  };
  return <section className="rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-4">
    <h2 className="text-sm font-bold text-cyan-100">Detección local de voz (VAD)</h2>
    <p className="mt-2 text-xs leading-5 text-slate-300">Analiza ventanas de 25 ms directamente en este navegador. El audio no se sube. Detecta actividad acústica, no transcribe ni identifica quién habla o el idioma; revisa todos los límites antes de publicar.</p>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button type="button" onClick={()=>void analyze()} disabled={busy||remaining<1} className="rounded-lg border border-cyan-300/30 bg-cyan-500/15 px-4 py-2 text-sm font-semibold text-cyan-100 disabled:opacity-50">{busy?'Analizando localmente…':'Analizar voz localmente'}</button>
      {found.length>0&&<button type="button" onClick={()=>{onApply(found);setFound([]);}} className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white">Añadir {found.length} cortes</button>}
      {found.length>0&&<span className="text-xs text-slate-300">{found.length} intervenciones detectadas</span>}
    </div>
    {error&&<p role="status" className="mt-2 text-xs text-amber-200">{error}</p>}
    {found.length>0&&<ol className="mt-3 grid gap-1 text-xs text-slate-300 sm:grid-cols-2">{found.map((s,i)=><li key={i}>Turno {i+1}: {s.start.toFixed(2)}–{s.end.toFixed(2)} s · nivel relativo de señal {(s.signalLevel*100).toFixed(0)}%</li>)}</ol>}
  </section>;
}
