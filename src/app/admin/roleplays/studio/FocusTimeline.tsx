'use client';

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { studioTimelineWindow, studioTimelineGeometry, type StudioTimelineCut } from '@/lib/roleplay-studio/focus-timeline';
import type { StudioSpeakerRole } from '@/lib/roleplay-studio/speaker-profiles';

type TimelineTurn = StudioTimelineCut & { title: string; speakerRole: StudioSpeakerRole; ranges?: readonly { start: number; end: number }[] };
type Props = {
  duration: number;
  playhead: number;
  active: readonly TimelineTurn[];
  excluded: readonly TimelineTurn[];
  selectedId?: string;
  onSelect: (id: string, excluded: boolean) => void;
  onSeek: (seconds: number) => void;
};
const roles: { role: StudioSpeakerRole; label: string; color: string }[] = [
  { role: 'doctor', label: 'Médico', color: 'bg-blue-600' },
  { role: 'patient', label: 'Paciente', color: 'bg-emerald-600' },
  { role: 'nurse', label: 'Enfermería', color: 'bg-violet-600' },
  { role: 'operator', label: 'Operador', color: 'bg-cyan-700' },
  { role: 'interpreter', label: 'Intérprete original', color: 'bg-orange-600' },
  { role: 'unknown', label: 'Sin identificar', color: 'bg-slate-500' },
];

const labelTime = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  return (hours ? hours + ':' : '') + String(Math.floor(whole / 60) % 60).padStart(2, '0') + ':' + String(whole % 60).padStart(2, '0');
};

/** Metadata-only timeline: uses the existing media player, never decodes audio. */
export default function FocusTimeline({ duration, playhead, active, excluded, selectedId, onSelect, onSeek }: Props) {
  const [span, setSpan] = useState(30);
  const [anchor, setAnchor] = useState<number | null>(null);
  const selectedStart = useMemo(() => active.find(turn => turn.id === selectedId)?.start, [active, selectedId]);
  const center = anchor ?? selectedStart ?? playhead;
  const window = useMemo(() => studioTimelineWindow(duration, center, span || duration), [duration, center, span]);
  const width = window.end - window.start;
  const cursor = (playhead - window.start) / width * 100;
  const ordered = useMemo(() => [...active].sort((a, b) => a.start - b.start), [active]);
  const lanes = useMemo(() => [
    ...roles.map(role => ({ ...role, excluded: false, turns: ordered.filter(turn => turn.speakerRole === role.role) })),
    { role: 'excluded', label: 'Excluidas', color: 'bg-slate-500', excluded: true, turns: [...excluded].sort((a, b) => a.start - b.start) },
  ].filter(lane => lane.turns.length > 0), [ordered, excluded]);

  // Keep event handlers current without rebuilding all the visible cuts on
  // every parent render. Only committed callbacks are exposed to user events.
  const callbacks = useRef({ onSelect, onSeek });
  useLayoutEffect(() => { callbacks.current = { onSelect, onSeek }; }, [onSelect, onSeek]);
  const select = useCallback((id: string, isExcluded: boolean) => {
    const turn = (isExcluded ? excluded : active).find(item => item.id === id);
    if (!turn) return;
    setAnchor(isExcluded ? turn.start : null);
    callbacks.current.onSelect(id, isExcluded);
    if (Number.isFinite(turn.start)) callbacks.current.onSeek(Math.min(duration, Math.max(0, turn.start)));
  }, [active, excluded, duration]);

  const laneLayers = useMemo(() => lanes.map(lane => ({
    ...lane,
    buttons: lane.turns.map(turn => {
      const pieces = turn.ranges?.length ? turn.ranges : [turn];
      return pieces.map((piece, index) => {
        const geometry = studioTimelineGeometry({ ...piece, id: turn.id }, window);
        if (!geometry) return null;
        const name = (lane.excluded ? 'Excluida: ' : 'Intervención: ') + turn.title + (pieces.length > 1 ? ' · corte ' + (index + 1) : '');
        return <button key={turn.id + ':' + index} type="button" aria-label={name} title={name}
          aria-pressed={!lane.excluded && selectedId === turn.id}
          onClick={() => select(turn.id, lane.excluded)}
          className={'absolute inset-y-0 rounded-sm border border-white/40 text-xs text-white focus-visible:z-20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--theme-focus)] ' + lane.color + (lane.excluded ? ' opacity-60 border-dashed' : '') + (!lane.excluded && selectedId === turn.id ? ' z-10 ring-2 ring-inset ring-white' : '')}
          style={{ left: geometry.left + '%', width: geometry.width + '%' }}>
          <span aria-hidden="true" className="block truncate px-0.5">{turn.title}</span>
        </button>;
      });
    }),
  })), [lanes, window, selectedId, select]);
  const activeOptions = useMemo(() => ordered.map((turn, i) =>
    <option key={turn.id} value={'a:' + turn.id}>#{i + 1} · {turn.title}</option>), [ordered]);
  const excludedOptions = useMemo(() => excluded.map(turn =>
    <option key={turn.id} value={'x:' + turn.id}>{turn.title}</option>), [excluded]);

  return (
    <section aria-label="Línea de tiempo de intervenciones" className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--theme-panel)] p-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1 text-[var(--text-secondary)]">Ventana
          <select aria-label="Escala de intervenciones" value={span} onChange={event => { setSpan(Number(event.currentTarget.value)); setAnchor(null); }}
            className="rounded border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] px-2 py-1 text-[var(--theme-control-text)]">
            <option value={30}>30 s</option><option value={120}>2 min</option><option value={0}>Completa</option>
          </select>
        </label>
        <button type="button" aria-label="Ventana temporal anterior" disabled={window.start <= 0}
          onClick={() => setAnchor((window.start + window.end) / 2 - width * 0.75)}
          className="theme-action-secondary rounded px-2 py-1 disabled:opacity-40">−</button>
        <button type="button" aria-label="Ventana temporal siguiente" disabled={window.end >= duration}
          onClick={() => setAnchor((window.start + window.end) / 2 + width * 0.75)}
          className="theme-action-secondary rounded px-2 py-1 disabled:opacity-40">+</button>
        <button type="button" onClick={() => setAnchor(playhead)} className="theme-action-secondary rounded px-2 py-1">Ir al cursor</button>
        <button type="button" onClick={() => setAnchor(null)} className="theme-action-secondary rounded px-2 py-1">Centrar intervención</button>
        <span className="ml-auto tabular-nums text-[var(--text-secondary)]">{labelTime(window.start)}–{labelTime(window.end)}</span>
      </div>
      <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">Posición en ventana
        <input type="range" aria-label="Posición en la ventana temporal" min={window.start} max={window.end} step={0.01}
          value={Math.max(window.start, Math.min(window.end, playhead))}
          onChange={event => { setAnchor((window.start + window.end) / 2); onSeek(event.currentTarget.valueAsNumber); }}
          className="min-w-0 flex-1 accent-blue-500"/>
      </label>
      <div className="max-h-40 space-y-1 overflow-y-auto">
        {laneLayers.map(lane => (
          <div key={lane.role} className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-2">
            <span className="truncate text-xs text-[var(--text-secondary)]" title={lane.label}>{lane.label}</span>
            <div className="relative h-7 overflow-hidden rounded border border-[var(--border)] bg-[var(--theme-surface-muted)]">
              {lane.buttons}
              {cursor >= 0 && cursor <= 100 && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 z-20 w-px bg-[var(--foreground)]" style={{ left: cursor + '%' }}/>}
            </div>
          </div>
        ))}
      </div>
      <label className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">Localizar corte
        <select aria-label="Localizar corte en línea de tiempo" value="" onChange={event => {
          const value = event.currentTarget.value;
          if (value) select(value.slice(2), value.startsWith('x:'));
        }} className="min-w-0 flex-1 rounded border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] px-2 py-1 text-[var(--theme-control-text)]">
          <option value="">Elegir intervención, incluso fuera de ventana</option>
          <optgroup label="Activas">{activeOptions}</optgroup>
          <optgroup label="Excluidas">{excludedOptions}</optgroup>
        </select>
      </label>
    </section>
  );
}
