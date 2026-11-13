'use client';

import { useEffect, useState } from 'react';
import {
  calculateWaveformPeaks,
  canRenderWaveform,
  WAVEFORM_BAR_COUNT,
} from '@/lib/roleplay-studio/audio-peaks';

export type WaveformInterval = {
  id: string;
  start: number;
  end: number;
};

type PreviewStatus = 'loading' | 'ready' | 'limited' | 'unavailable';

export interface StudioWaveformProps {
  file: File;
  duration: number;
  currentTime: number;
  segments: readonly WaveformInterval[];
  onSeek: (time: number) => void;
}

const CHART_WIDTH = 720;
const CHART_HEIGHT = 96;
const HALF_HEIGHT = CHART_HEIGHT / 2;

function timeLabel(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds));
  return String(Math.floor(value / 60)).padStart(2, '0') + ':' +
    String(value % 60).padStart(2, '0');
}

/**
 * Audio never leaves the browser to calculate peaks. A real audio element
 * remains the source of truth for seeking and segment-preview boundaries.
 */
export default function StudioWaveform({
  file, duration, currentTime, segments, onSeek,
}: StudioWaveformProps) {
  const [peaks, setPeaks] = useState<number[]>([]);
  const [status, setStatus] = useState<PreviewStatus>('loading');

  useEffect(() => {
    let cancelled = false;
    if (!canRenderWaveform(duration, file.size)) {
      setPeaks([]);
      setStatus('limited');
      return () => { cancelled = true; };
    }

    setStatus('loading');
    setPeaks([]);
    const load = async () => {
      let context: AudioContext | null = null;
      try {
        if (typeof window.AudioContext !== 'function') {
          if (!cancelled) setStatus('unavailable');
          return;
        }
        const data = await file.arrayBuffer();
        if (cancelled) return;
        context = new window.AudioContext();
        const decoded = await context.decodeAudioData(data);
        if (cancelled) return;
        if (decoded.duration > 240 || decoded.numberOfChannels < 1) {
          setStatus('limited');
          return;
        }
        const channels: Float32Array[] = [];
        for (let i = 0; i < Math.min(2, decoded.numberOfChannels); i++) {
          channels.push(decoded.getChannelData(i));
        }
        const result = calculateWaveformPeaks(channels, WAVEFORM_BAR_COUNT);
        if (!cancelled) {
          setPeaks(result);
          setStatus(result.length ? 'ready' : 'unavailable');
        }
      } catch {
        if (!cancelled) setStatus('unavailable');
      } finally {
        if (context) await context.close().catch(() => {});
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [file, duration]);

  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 1;
  const safeTime = Math.min(safeDuration, Math.max(0, Number.isFinite(currentTime) ? currentTime : 0));
  const progressX = safeTime / safeDuration * CHART_WIDTH;
  const bars = status === 'ready' ? peaks : new Array<number>(WAVEFORM_BAR_COUNT).fill(0.04);

  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/80 p-4" data-testid="audio-studio-waveform">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-white">Línea de tiempo del audio</p>
        <p className="text-xs text-slate-400">
          {status === 'ready' ? 'Ondas generadas localmente' :
            status === 'loading' ? 'Preparando ondas…' :
            status === 'limited' ? 'Vista de tiempo simplificada' : 'Vista de ondas no disponible'}
        </p>
      </div>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        className="block h-24 w-full overflow-hidden rounded-lg bg-slate-900"
      >
        <line x1={0} y1={HALF_HEIGHT} x2={CHART_WIDTH} y2={HALF_HEIGHT}
          stroke="currentColor" className="text-slate-700" strokeWidth={1}/>
        {bars.map((peak, index) => {
          const width = CHART_WIDTH / bars.length;
          const height = Math.max(3, Math.min(1, peak) * (CHART_HEIGHT - 10));
          return (
            <rect key={index}
              x={index * width} y={(CHART_HEIGHT - height) / 2}
              width={Math.max(0.6, width - 0.7)} height={height}
              className="fill-blue-400/80"/>
          );
        })}
        {segments.filter(segment =>
          Number.isFinite(segment.start) && Number.isFinite(segment.end) &&
          segment.start >= 0 && segment.end > segment.start && segment.end <= safeDuration
        ).map(segment => (
          <rect key={segment.id}
            x={segment.start / safeDuration * CHART_WIDTH} y={0}
            width={(segment.end - segment.start) / safeDuration * CHART_WIDTH}
            height={CHART_HEIGHT} className="fill-emerald-400/25"/>
        ))}
        <line x1={progressX} y1={0} x2={progressX} y2={CHART_HEIGHT}
          strokeWidth={2.5} className="stroke-amber-300"/>
      </svg>
      <input
        aria-label="Posición del reproductor en segundos"
        type="range"
        min={0}
        max={safeDuration}
        step={0.1}
        value={safeTime}
        onChange={event => {
          const value = event.currentTarget.valueAsNumber;
          if (Number.isFinite(value)) onSeek(Math.min(safeDuration, Math.max(0, value)));
        }}
        className="mt-2 w-full cursor-pointer accent-blue-400"
      />
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span>{timeLabel(safeTime)}</span>
        <span>{timeLabel(safeDuration)}</span>
      </div>
      {status === 'limited' && (
        <p className="mt-3 text-xs leading-5 text-amber-200">
          Para proteger la memoria del navegador, las ondas solo se calculan en grabaciones
          de hasta 4 minutos y 8 MiB. Los marcadores de fragmentos y la navegación temporal
          siguen disponibles para audios más largos.
        </p>
      )}
      {status === 'unavailable' && (
        <p className="mt-3 text-xs text-slate-400">
          No se pudo dibujar el audio en este navegador. Puedes seguir escuchando,
          marcando y exportando los fragmentos normalmente.
        </p>
      )}
    </div>
  );
}
