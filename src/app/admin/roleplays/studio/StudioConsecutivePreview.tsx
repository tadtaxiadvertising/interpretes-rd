'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildConsecutivePreviewPlan, consecutivePracticePause, type PreviewSourceTurn } from '@/lib/roleplay-studio/consecutive-preview';

type PreviewPhase = 'idle' | 'playing' | 'practice' | 'repetition' | 'ready' | 'complete' | 'error';

interface StudioConsecutivePreviewProps {
  sourceUrl: string;
  sourceDuration: number;
  segments: readonly PreviewSourceTurn[];
  interruptRevision?: number;
  onStart?: () => void;
}

function timeLabel(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const mins = Math.floor(safe / 60).toString().padStart(2, '0');
  const secs = Math.floor(safe % 60).toString().padStart(2, '0');
  return mins + ':' + secs;
}

/**
 * Local-only preview for the administrative editor. It never records audio,
 * persists state, invokes a server action or modifies an assessment.
 */
export default function StudioConsecutivePreview({
  sourceUrl,
  sourceDuration,
  segments,
  interruptRevision = 0,
  onStart,
}: StudioConsecutivePreviewProps) {
  const result = useMemo(() => {
    try {
      return { plan: buildConsecutivePreviewPlan(segments, sourceDuration), error: '' };
    } catch (error) {
      return {
        plan: null,
        error: error instanceof Error ? error.message : 'No se pudieron revisar los cortes.',
      };
    }
  }, [segments, sourceDuration]);
  const turns = result.plan?.turns ?? [];

  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<PreviewPhase>('idle');
  const [speed, setSpeed] = useState(1);
  const [multiplier, setMultiplier] = useState(1.2);
  const [fixedSeconds, setFixedSeconds] = useState(3);
  const [autoAdvance, setAutoAdvance] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [deadline, setDeadline] = useState(0);
  const [repeatCount, setRepeatCount] = useState(0);
  const [message, setMessage] = useState('');

  const audio = useRef<HTMLAudioElement | null>(null);
  const activeTurn = useRef<{ id: string; end: number } | null>(null);
  const requestId = useRef(0);

  const stopAudio = useCallback(() => {
    requestId.current++;
    activeTurn.current = null;
    audio.current?.pause();
  }, []);

  const playTurn = useCallback((target: number) => {
    const element = audio.current;
    const turn = turns[target];
    if (!sourceUrl || !element || !turn) return;

    stopAudio();
    const request = requestId.current;
    activeTurn.current = { id: turn.id, end: turn.end };
    setIndex(target);
    setRemaining(0);
    setDeadline(0);
    setMessage('');
    setPhase('playing');
    element.playbackRate = speed;
    element.currentTime = turn.start;
    onStart?.();

    try {
      void Promise.resolve(element.play()).catch(() => {
        if (request === requestId.current) {
          activeTurn.current = null;
          setPhase('error');
          setMessage('No fue posible reproducir este fragmento. Revisa el MP3 original.');
        }
      });
    } catch {
      if (request === requestId.current) {
        activeTurn.current = null;
        setPhase('error');
        setMessage('No fue posible reproducir este fragmento. Revisa el MP3 original.');
      }
    }
  }, [onStart, sourceUrl, speed, stopAudio, turns]);

  // Destroy any pending playback or countdown when an editor cut changes,
  // the source file changes, or the original editing player starts.
  useEffect(() => {
    stopAudio();
    setIndex(0);
    setPhase('idle');
    setDeadline(0);
    setRemaining(0);
    setRepeatCount(0);
    setMessage('');
    return () => {
      stopAudio();
    };
  }, [sourceUrl, segments, sourceDuration, interruptRevision, stopAudio]);

  const finishTurn = () => {
    const current = activeTurn.current;
    if (!current || current.id !== turns[index]?.id) return;
    stopAudio();
    try {
      const pause = consecutivePracticePause(turns[index].duration, multiplier, fixedSeconds);
      setRemaining(pause);
      setDeadline(Date.now() + pause * 1000);
      setPhase('practice');
    } catch {
      setPhase('error');
      setMessage('Revisa el multiplicador y la pausa fija.');
    }
  };

  useEffect(() => {
    if (phase !== 'practice' && phase !== 'repetition') return;
    // Guard the deadline as a one-shot transition. Two timer ticks can arrive
    // before React commits the next phase (especially under a loaded browser).
    // Without this flag one repetition can restart audio multiple times.
    let completed = false;
    const tick = () => {
      if (completed) return;
      const left = Math.max(0, (deadline - Date.now()) / 1000);
      setRemaining(left);
      if (left > 0) return;
      completed = true;
      if (phase === 'repetition') {
        playTurn(index);
      } else if (autoAdvance && index < turns.length - 1) {
        playTurn(index + 1);
      } else {
        setPhase(index === turns.length - 1 ? 'complete' : 'ready');
      }
    };
    tick();
    const timer = window.setInterval(tick, 100);
    return () => window.clearInterval(timer);
  }, [autoAdvance, deadline, index, phase, playTurn, turns.length]);

  const reset = () => {
    stopAudio();
    setIndex(0);
    setPhase('idle');
    setDeadline(0);
    setRemaining(0);
    setRepeatCount(0);
    setMessage('');
  };

  const requestRepetition = () => {
    if (!turns[index]) return;
    stopAudio();
    setRepeatCount(n => n + 1);
    setRemaining(3);
    setDeadline(Date.now() + 3000);
    setPhase('repetition');
  };

  const advance = (step: number) => {
    const nextIndex = index + step;
    if (nextIndex >= 0 && nextIndex < turns.length) playTurn(nextIndex);
  };

  const turn = turns[index];
  const canPlay = Boolean(sourceUrl && turn);
  const busy = ['playing', 'practice', 'repetition'].includes(phase);

  return (
    <section aria-label="Simulador consecutivo de prueba" className="space-y-4 rounded-2xl border border-indigo-400/25 bg-indigo-500/5 p-5">
      <div>
        <h2 className="text-lg font-bold text-white">Simulador consecutivo · vista previa</h2>
        <p className="mt-1 text-sm leading-5 text-slate-300">
          Reproduce cada intervención, deja una pausa para interpretar y permite pedir repetición.
          Solo funciona en este navegador del administrador: no graba, no crea sesiones ni modifica QA.
        </p>
      </div>
      {result.error ? (
        <p role="status" className="text-sm text-amber-300">{result.error}</p>
      ) : (
        <>
          {result.plan!.excludedInterpreterCount > 0 && (
            <p className="text-sm text-amber-300">
              Se excluyen {result.plan!.excludedInterpreterCount} fragmentos del intérprete original de esta simulación.
              Debes quitarlos también del editor antes de exportar.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm text-slate-200">Pausa por duración (×)
              <select aria-label="Multiplicador de pausa" value={multiplier} onChange={e => setMultiplier(Number(e.currentTarget.value))}
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-white">
                <option value={0.5}>0.5×</option>
                <option value={1}>1×</option>
                <option value={1.2}>1.2×</option>
                <option value={1.5}>1.5×</option>
                <option value={2}>2×</option>
                <option value={3}>3×</option>
              </select>
            </label>
            <label className="text-sm text-slate-200">Segundos extra
              <select aria-label="Pausa fija" value={fixedSeconds} onChange={e => setFixedSeconds(Number(e.currentTarget.value))}
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-white">
                {[0, 3, 5, 10, 15, 30].map(n => <option key={n} value={n}>{n} s</option>)}
              </select>
            </label>
            <label className="text-sm text-slate-200">Velocidad de escucha
              <select aria-label="Velocidad de escucha" value={speed} onChange={e => setSpeed(Number(e.currentTarget.value))}
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-white">
                <option value={0.85}>0.85×</option>
                <option value={1}>1× (original)</option>
                <option value={1.15}>1.15×</option>
              </select>
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-200">
            <input type="checkbox" checked={autoAdvance} onChange={e => setAutoAdvance(e.currentTarget.checked)} />
            Pasar automáticamente al siguiente turno al terminar la pausa
          </label>
          <audio
            ref={audio}
            src={sourceUrl}
            preload="metadata"
            onTimeUpdate={e => {
              if (activeTurn.current && e.currentTarget.currentTime >= activeTurn.current.end - 0.025) {
                finishTurn();
              }
            }}
            onEnded={() => {
              if (activeTurn.current) {
                setMessage('El MP3 terminó antes del final seleccionado. Revisa los cortes.');
                stopAudio();
                setPhase('error');
              }
            }}
          />
          <div className="rounded-xl border border-white/10 bg-slate-950/70 p-4">
            <p className="font-semibold text-white">Turno {index + 1} de {turns.length} · {turn?.title}</p>
            <p className="mt-1 text-sm text-slate-400">
              {timeLabel(turn?.start ?? 0)} – {timeLabel(turn?.end ?? 0)}
              {' · '}Repeticiones solicitadas: {repeatCount}
            </p>
            <p role="status" aria-live="polite" className="mt-3 text-sm font-medium text-indigo-200">
              {phase === 'idle' && 'Listo para practicar'}
              {phase === 'playing' && 'Escuchando intervención'}
              {phase === 'practice' && 'Tu turno para interpretar: ' + Math.ceil(remaining) + ' s'}
              {phase === 'repetition' && 'Protocolo de repetición: ' + Math.ceil(remaining) + ' s'}
              {phase === 'ready' && 'Pausa completada. Continúa al siguiente turno.'}
              {phase === 'complete' && 'Vista previa completada. Revisa los cortes antes de exportar.'}
              {phase === 'error' && message}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => {
                if (busy) { stopAudio(); setPhase('ready'); setRemaining(0); }
                else playTurn(phase === 'complete' ? 0 : phase === 'ready' && index < turns.length - 1 ? index + 1 : index);
              }} disabled={!canPlay}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {busy ? 'Detener simulación' : phase === 'ready' ? 'Continuar' : 'Reproducir turno'}
              </button>
              <button type="button" onClick={() => advance(-1)} disabled={!canPlay || index === 0}
                className="rounded-lg border border-white/15 px-3 py-2 text-sm text-slate-200 disabled:opacity-40">Anterior</button>
              <button type="button" onClick={() => advance(1)} disabled={!canPlay || index >= turns.length - 1}
                className="rounded-lg border border-white/15 px-3 py-2 text-sm text-slate-200 disabled:opacity-40">Siguiente</button>
              <button type="button" onClick={requestRepetition} disabled={!canPlay}
                className="rounded-lg border border-amber-400/30 px-3 py-2 text-sm text-amber-200 disabled:opacity-40">
                Pedir repetición (3 s)
              </button>
              <button type="button" onClick={reset} className="rounded-lg border border-white/15 px-3 py-2 text-sm text-slate-200">
                Reiniciar
              </button>
            </div>
          </div>
          <p className="text-xs leading-5 text-slate-400">
            La velocidad cambia solamente la escucha en esta vista previa. No modifica el archivo MP3,
            la biblioteca, las grabaciones ni las puntuaciones de QA.
          </p>
        </>
      )}
    </section>
  );
}
