'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { formatStudioAccessibleTime } from '@/lib/roleplay-studio/format-time';
import { withStudioDecodeSlot } from '@/lib/roleplay-studio/decode-slot';
import { detectLocalSpeech, type LocalVadSnapshot } from '@/lib/roleplay-studio/local-vad';
import {
  calculateWaveformPeaks,
  canDecodeWaveformWithinMemoryBudget,
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
  onLocalVadResult?: (source: File, result: LocalVadSnapshot) => void;
}

const CHART_WIDTH = 720;
const CHART_HEIGHT = 96;
const HALF_HEIGHT = CHART_HEIGHT / 2;
// Fixed ratios preserve existing zoom controls, with ~10-second inspection
// windows even for twelve-hour sources. Only coordinates change; no PCM decode.
const ZOOM_LEVELS = [1, 4, 12, 60, 240, 720, 2400, 4320] as const;
const MIN_VIEW_SECONDS = 10;

function preciseTimeLabel(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const centiseconds = Math.round(safe * 100);
  const wholeSeconds = Math.floor(centiseconds / 100);
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = String(Math.floor(wholeSeconds / 60) % 60).padStart(2, '0');
  const secondsPart = String(wholeSeconds % 60).padStart(2, '0');
  const fraction = String(centiseconds % 100).padStart(2, '0');
  return hours
    ? `${String(hours).padStart(2, '0')}:${minutes}:${secondsPart}.${fraction}`
    : `${String(Math.floor(wholeSeconds / 60)).padStart(2, '0')}:${secondsPart}.${fraction}`;
}

function timeLabel(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor(value / 60) % 60;
  const tail = String(minutes).padStart(2, '0') + ':' +
    String(value % 60).padStart(2, '0');
  return hours ? String(hours).padStart(2, '0') + ':' + tail : tail;
}

/**
 * Audio never leaves the browser to calculate peaks. A real audio element
 * remains the source of truth for seeking and segment-preview boundaries.
 */
export default function StudioWaveform({
  file, duration, currentTime, segments, onSeek, onLocalVadResult,
}: StudioWaveformProps) {
  const [peaks, setPeaks] = useState<number[]>([]);
  const [status, setStatus] = useState<PreviewStatus>('loading');
  const [zoom, setZoom] = useState<number>(1);
  const [requestedStart, setRequestedStart] = useState(0);
  // Keep notifications current without re-decoding whenever the parent renders.
  const vadNotification = useRef(onLocalVadResult);
  vadNotification.current = onLocalVadResult;

  // Opening another file must not inherit a narrow viewport from the prior
  // multi-hour recording, especially if its zoom choice is now unavailable.
  useEffect(() => {
    setZoom(1);
    setRequestedStart(0);
  }, [file]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    let context: AudioContext | null = null;
    const send = (result: LocalVadSnapshot) => {
      if (!cancelled && /\.mp3$/i.test(file.name)) {
        vadNotification.current?.(file, result);
      }
    };
    if (!canRenderWaveform(duration, file.size)) {
      setPeaks([]);
      setStatus('limited');
      send({ status: 'limited', segments: [] });
      return () => { cancelled = true; };
    }

    send({ status: 'loading', segments: [] });
    setStatus('loading');
    setPeaks([]);
    const load = async () => {
      try {
        if (typeof window.AudioContext !== 'function') {
          if (!cancelled) {
            setStatus('unavailable');
            send({ status: 'unavailable', segments: [] });
          }
          return;
        }
        const data = await file.arrayBuffer();
        if (cancelled) return;
        context = new window.AudioContext();
        // Even a small MP3 may expand to hundreds of MiB on a high-rate
        // device. Preserve the lightweight time ruler instead of allocating
        // potentially excessive decoded PCM. This is an estimate, not a
        // guarantee of the browser decoder's peak internal memory usage.
        if (!canDecodeWaveformWithinMemoryBudget(duration, context.sampleRate)) {
          if (!cancelled) {
            setStatus('limited');
            send({ status: 'limited', segments: [] });
          }
          return;
        }
        const decoded = await context.decodeAudioData(data);
        if (cancelled) return;
        if (decoded.duration <= 0 || decoded.duration > 240 ||
            decoded.numberOfChannels < 1 || decoded.sampleRate < 8000 ||
            decoded.sampleRate > 192000) {
          if (!cancelled) {
            setStatus('unavailable');
            send({ status: 'unavailable', segments: [] });
          }
          return;
        }
        const channels: Float32Array[] = [];
        for (let i = 0; i < Math.min(2, decoded.numberOfChannels); i++) {
          channels.push(decoded.getChannelData(i));
        }
        const result = calculateWaveformPeaks(channels, WAVEFORM_BAR_COUNT);
        if (!cancelled) {
          // Only one PCM decoding feeds BOTH the waveform and the local VAD.
          // Retain small timing metadata, never decoded channels or full media.
          const speech = /\.mp3$/i.test(file.name) && vadNotification.current
            ? detectLocalSpeech(channels, decoded.sampleRate) : [];
          setPeaks(result);
          setStatus(result.length ? 'ready' : 'unavailable');
          send({
            status: result.length ? 'ready' : 'unavailable',
            segments: speech,
          });
        }
      } catch {
        if (!cancelled) {
          setStatus('unavailable');
          send({ status: 'unavailable', segments: [] });
        }
      } finally {
        if (context) await context.close().catch(() => {});
      }
    };
    void withStudioDecodeSlot(controller.signal, load).catch(() => {});
    return () => {
      cancelled = true;
      controller.abort();
      // Keep the slot until the native decode settles. Closing the context
      // here does not guarantee that the decoder has stopped allocating.
      // The task's finally closes it before releasing the slot.
    };
  }, [file, duration]);

  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 1;
  const availableZoomLevels = ZOOM_LEVELS.filter(level =>
    level === 1 || safeDuration / level >= MIN_VIEW_SECONDS);
  const safeTime = Math.min(safeDuration, Math.max(0, Number.isFinite(currentTime) ? currentTime : 0));
  // Zoom changes only the viewport, never the underlying audio or decoding budget.
  const windowSeconds = safeDuration / zoom;
  const maxStart = safeDuration - windowSeconds;
  const windowStart = Math.min(maxStart, Math.max(0, requestedStart));
  const windowEnd = windowStart + windowSeconds;
  const playheadVisible = safeTime >= windowStart && safeTime <= windowEnd;
  const progressX = (safeTime - windowStart) / windowSeconds * CHART_WIDTH;
  const bars = useMemo(() => Array.from({ length: WAVEFORM_BAR_COUNT }, (_, index) => {
    if (status !== 'ready' || !peaks.length) return 0.04;
    const at = windowStart + (index + 0.5) / WAVEFORM_BAR_COUNT * windowSeconds;
    const sourceIndex = Math.min(peaks.length - 1, Math.floor(at / safeDuration * peaks.length));
    return peaks[sourceIndex];
  }), [status, peaks, safeDuration, windowSeconds, windowStart]);
  // The cursor moves independently of the static SVG layers. Reuse the
  // elements until the source peaks, viewport or editorial intervals change.
  const waveformBars = useMemo(() => bars.map((peak, index) => {
    const width = CHART_WIDTH / bars.length;
    const height = Math.max(3, Math.min(1, peak) * (CHART_HEIGHT - 10));
    return (
      <rect key={index}
        x={index * width} y={(CHART_HEIGHT - height) / 2}
        width={Math.max(0.6, width - 0.7)} height={height}
        className="fill-[var(--theme-link)]"/>
    );
  }), [bars]);
  const segmentMarkers = useMemo(() => segments.filter(segment =>
    Number.isFinite(segment.start) && Number.isFinite(segment.end) &&
    segment.start >= 0 && segment.end > segment.start && segment.end <= safeDuration &&
    segment.end > windowStart && segment.start < windowEnd
  ).map(segment => (
    <rect key={segment.id} data-testid="studio-window-segment"
      x={(Math.max(segment.start, windowStart) - windowStart) / windowSeconds * CHART_WIDTH} y={0}
      width={(Math.min(segment.end, windowEnd) - Math.max(segment.start, windowStart)) / windowSeconds * CHART_WIDTH}
      height={CHART_HEIGHT} className="fill-[var(--theme-success)] opacity-25"/>
  )),
    [segments, safeDuration, windowStart, windowEnd, windowSeconds]);
  const centerOnPlayhead = (scale: number) => {
    // Never expose an unusably narrow window on short recordings.
    if (!availableZoomLevels.includes(scale as typeof ZOOM_LEVELS[number])) return;
    const span = safeDuration / scale;
    setRequestedStart(Math.min(safeDuration - span, Math.max(0, safeTime - span / 2)));
    setZoom(scale);
  };
  const pan = (direction: -1 | 1) => {
    setRequestedStart(Math.min(maxStart, Math.max(0, windowStart + direction * windowSeconds * 0.75)));
  };

  return (
    <div className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--theme-panel)] p-3 sm:p-4" data-testid="audio-studio-waveform">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-[var(--foreground)]">Línea de tiempo del audio</p>
        <p className="text-xs text-[var(--text-secondary)]">
          {status === 'ready' ? 'Ondas generadas localmente' :
            status === 'loading' ? 'Preparando ondas…' :
            status === 'limited' ? 'Vista de tiempo simplificada' : 'Vista de ondas no disponible'}
        </p>
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <label className="flex w-full min-w-0 items-center gap-2 text-[var(--text-secondary)] sm:w-auto">
          Detalle
          <select
            aria-label="Zoom de la línea de tiempo"
            value={zoom}
            onChange={event => centerOnPlayhead(Number(event.currentTarget.value))}
            className="min-h-11 min-w-0 flex-1 rounded-md border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] px-2 py-1.5 text-[var(--theme-control-text)] sm:min-h-0"
          >
{availableZoomLevels.map(level => (
              <option key={level} value={level}>
                {level === 1 ? 'Completo' : `${level}× · ${timeLabel(safeDuration / level)}`}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => pan(-1)} disabled={zoom === 1 || windowStart <= 0}
          className="min-h-11 min-w-11 rounded-md border border-[var(--border)] px-2 py-1.5 text-[var(--foreground)] sm:min-h-0 sm:min-w-0 disabled:opacity-40">
          Anterior
        </button>
        <button type="button" onClick={() => pan(1)} disabled={zoom === 1 || windowStart >= maxStart}
          className="min-h-11 min-w-11 rounded-md border border-[var(--border)] px-2 py-1.5 text-[var(--foreground)] sm:min-h-0 sm:min-w-0 disabled:opacity-40">
          Siguiente
        </button>
        <button type="button" onClick={() => centerOnPlayhead(zoom)} disabled={zoom === 1}
          className="min-h-11 min-w-11 rounded-md border border-[var(--border)] px-2 py-1.5 text-[var(--foreground)] sm:min-h-0 sm:min-w-0 disabled:opacity-40">
          Ir al cursor
        </button>
        <button type="button" onClick={() => onSeek(Math.max(0, safeTime - 5))}
          aria-label="Retroceder cinco segundos"
          className="min-h-11 min-w-11 rounded-md border border-[var(--border)] px-2 py-1.5 text-[var(--foreground)] sm:min-h-0 sm:min-w-0">
          −5 s
        </button>
        <button type="button" onClick={() => onSeek(Math.min(safeDuration, safeTime + 5))}
          aria-label="Avanzar cinco segundos"
          className="min-h-11 min-w-11 rounded-md border border-[var(--border)] px-2 py-1.5 text-[var(--foreground)] sm:min-h-0 sm:min-w-0">
          +5 s
        </button>
        <span className="basis-full text-[var(--text-secondary)] sm:basis-auto">Ventana: {timeLabel(windowStart)}–{timeLabel(windowEnd)}</span>
      </div>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        className="block h-24 w-full cursor-crosshair overflow-hidden rounded-lg bg-[var(--theme-surface-muted)]"
        onClick={event => {
          const bounds = event.currentTarget.getBoundingClientRect();
          if (!(bounds.width > 0)) return;
          const fraction = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
          onSeek(Math.min(safeDuration, Math.max(0, windowStart + fraction * windowSeconds)));
        }}
      >
        <line x1={0} y1={HALF_HEIGHT} x2={CHART_WIDTH} y2={HALF_HEIGHT}
          stroke="currentColor" className="text-[var(--theme-control-border)]" strokeWidth={1}/>
        {waveformBars}
        {segmentMarkers}
        {playheadVisible && (
          <line x1={progressX} y1={0} x2={progressX} y2={CHART_HEIGHT}
            strokeWidth={2.5} className="stroke-[var(--theme-warning)]"/>
        )}
      </svg>
      <input
        aria-label="Posición del reproductor en segundos"
        type="range"
        min={windowStart}
        max={windowEnd}
        step={0.01}
        value={Math.min(windowEnd, Math.max(windowStart, safeTime))}
        aria-valuetext={formatStudioAccessibleTime(Math.min(windowEnd, Math.max(windowStart, safeTime)))}
        onChange={event => {
          const value = event.currentTarget.valueAsNumber;
          if (Number.isFinite(value)) onSeek(Math.min(safeDuration, Math.max(0, value)));
        }}
        className="mt-2 h-11 w-full cursor-pointer accent-[var(--theme-link)] sm:h-auto"
      />
      <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
        <span aria-label="Tiempo exacto del cursor">{preciseTimeLabel(safeTime)}</span>
        <span>{timeLabel(safeDuration)}</span>
      </div>
      {!playheadVisible && (
        <p className="mt-1 text-xs text-[var(--theme-warning)]">El cursor está fuera de esta ventana. Usa «Ir al cursor» para localizarlo.</p>
      )}
      {status === 'limited' && (
        <p className="mt-3 text-xs leading-5 text-[var(--theme-warning)]">
          Para proteger la memoria del navegador, las ondas solo se calculan en grabaciones
          de hasta 4 minutos y 8 MiB y cuando su tamaño estimado tras decodificar es seguro.
          La línea de tiempo y el zoom siguen disponibles sin decodificar el audio.
        </p>
      )}
      {status === 'unavailable' && (
        <p className="mt-3 text-xs text-[var(--text-secondary)]">
          No se pudo dibujar el audio en este navegador. Puedes seguir escuchando,
          marcando y exportando los fragmentos normalmente.
        </p>
      )}
    </div>
  );
}
