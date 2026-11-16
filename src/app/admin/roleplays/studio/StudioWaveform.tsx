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
const CHART_HEIGHT = 76;
const HALF_HEIGHT = CHART_HEIGHT / 2;
const ZOOM_LEVELS = [1, 2, 4, 8, 16, 32, 64, 128, 256] as const;

function timeLabel(seconds: number): string {
  const value = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(value / 3600);
  const m = String(Math.floor(value / 60) % 60).padStart(2, '0');
  const s = String(value % 60).padStart(2, '0');
  return h > 0 ? `${h}:${m}:${s}` : `${String(Math.floor(value / 60)).padStart(2, '0')}:${s}`;
}

/**
 * A virtual timeline: zooming only changes the visible time window.
 * It never decodes additional audio and works even when waveform peaks are unavailable.
 */
export default function StudioWaveform({
  file, duration, currentTime, segments, onSeek,
}: StudioWaveformProps) {
  const [peaks, setPeaks] = useState<number[]>([]);
  const [status, setStatus] = useState<PreviewStatus>('loading');
  const [zoom, setZoom] = useState(1);
  const [windowStart, setWindowStart] = useState(0);

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
  const span = safeDuration / zoom;
  const start = Math.min(Math.max(0, windowStart), Math.max(0, safeDuration - span));
  const end = start + span;
  const xAt = (second: number) => ((second - start) / span) * CHART_WIDTH;

  // Follow the playhead only when it leaves the visible time window, so manual
  // scrolling and inspecting another passage are not constantly overridden.
  useEffect(() => {
    if (safeTime < start || safeTime > end) {
      setWindowStart(Math.max(0, Math.min(safeDuration - span, safeTime - span / 4)));
    }
  }, [safeTime, safeDuration, span, start, end]);

  const setZoomLevel = (level: number) => {
    const next = Math.min(256, Math.max(1, level));
    const nextSpan = safeDuration / next;
    setZoom(next);
    setWindowStart(Math.max(0, Math.min(safeDuration - nextSpan, safeTime - nextSpan / 2)));
  };

  const pan = (direction: number) => {
    setWindowStart(previous =>
      Math.max(0, Math.min(safeDuration - span, previous + direction * span * 0.75)));
  };

  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/80 p-3" data-testid="audio-studio-waveform">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-white">Línea de tiempo · {timeLabel(safeDuration)}</p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
          <span>{status === 'ready' ? 'Ondas locales' :
            status === 'loading' ? 'Preparando ondas…' :
            status === 'limited' ? 'Vista de tiempo simplificada' : 'Ondas no disponibles'}</span>
          <button type="button" aria-label="Desplazar línea de tiempo hacia atrás"
            onClick={() => pan(-1)} disabled={zoom === 1 || start <= 0}
            className="rounded border border-white/15 px-2 py-1 disabled:opacity-30">←</button>
          <label className="inline-flex items-center gap-1">
            Zoom
            <select aria-label="Zoom de la línea de tiempo" value={zoom}
              onChange={event => setZoomLevel(Number(event.target.value))}
              className="rounded border border-white/15 bg-slate-900 px-2 py-1 text-white">
              {ZOOM_LEVELS.map(level => <option key={level} value={level}>{level}×</option>)}
            </select>
          </label>
          <button type="button" aria-label="Desplazar línea de tiempo hacia adelante"
            onClick={() => pan(1)} disabled={zoom === 1 || end >= safeDuration}
            className="rounded border border-white/15 px-2 py-1 disabled:opacity-30">→</button>
        </div>
      </div>
      <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        preserveAspectRatio="none" aria-hidden="true"
        className="block h-[76px] w-full cursor-crosshair overflow-hidden rounded-lg bg-slate-900"
        onClick={event => {
          const bounds = event.currentTarget.getBoundingClientRect();
          if (bounds.width > 0) onSeek(Math.min(safeDuration,
            Math.max(0, start + (event.clientX - bounds.left) / bounds.width * span)));
        }}>
        <line x1={0} y1={HALF_HEIGHT} x2={CHART_WIDTH} y2={HALF_HEIGHT}
          stroke="currentColor" className="text-slate-700" strokeWidth={1}/>
        {Array.from({ length: 9 }, (_, i) => (
          <line key={i} x1={i * CHART_WIDTH / 8} y1={0} x2={i * CHART_WIDTH / 8}
            y2={CHART_HEIGHT} className="stroke-white/10" strokeWidth={0.7}/>
        ))}
        {status === 'ready' && Array.from({ length: WAVEFORM_BAR_COUNT }, (_, index) => {
          const sampleTime = start + (index + 0.5) / WAVEFORM_BAR_COUNT * span;
          const peak = peaks[Math.min(peaks.length - 1,
            Math.floor(sampleTime / safeDuration * peaks.length))] || 0;
          const width = CHART_WIDTH / WAVEFORM_BAR_COUNT;
          const height = Math.max(2, Math.min(1, peak) * (CHART_HEIGHT - 8));
          return <rect key={index} x={index * width} y={(CHART_HEIGHT - height) / 2}
            width={Math.max(0.6, width - 0.7)} height={height} className="fill-blue-400/80"/>;
        })}
        {segments.filter(segment =>
          Number.isFinite(segment.start) && Number.isFinite(segment.end) &&
          segment.start >= 0 && segment.end > segment.start && segment.end <= safeDuration &&
          segment.end >= start && segment.start <= end
        ).map(segment => (
          <rect key={segment.id} x={Math.max(0, xAt(segment.start))} y={0}
            width={Math.max(0, Math.min(CHART_WIDTH, xAt(segment.end)) -
              Math.max(0, xAt(segment.start)))}
            height={CHART_HEIGHT} className="fill-emerald-400/25"/>
        ))}
        {safeTime >= start && safeTime <= end && (
          <line x1={xAt(safeTime)} y1={0} x2={xAt(safeTime)} y2={CHART_HEIGHT}
            strokeWidth={2.5} className="stroke-amber-300"/>
        )}
      </svg>
      <div className="mt-1 flex justify-between font-mono text-[11px] text-slate-400">
        <span>{timeLabel(start)}</span>
        <span>Ventana: {timeLabel(span)}</span>
        <span>{timeLabel(end)}</span>
      </div>
      <input aria-label="Posición del reproductor en segundos" type="range" min={0}
        max={safeDuration} step={0.1} value={safeTime}
        onChange={event => {
          const value = event.currentTarget.valueAsNumber;
          if (Number.isFinite(value)) onSeek(Math.min(safeDuration, Math.max(0, value)));
        }}
        className="mt-2 w-full cursor-pointer accent-blue-400"/>
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span>{timeLabel(safeTime)}</span><span>{timeLabel(safeDuration)}</span>
      </div>
      {status === 'limited' && (
        <p className="mt-1 text-xs text-amber-200">
          Para proteger la memoria del navegador, las ondas solo se calculan en archivos
          de hasta 4 minutos y 8 MiB. El zoom, los cortes y la navegación siguen disponibles.
        </p>
      )}
      {status === 'unavailable' && (
        <p className="mt-1 text-xs text-slate-400">
          No se pudo dibujar el audio. La navegación y los cortes siguen disponibles.
        </p>
      )}
    </div>
  );
}
