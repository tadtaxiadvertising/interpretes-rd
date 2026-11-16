'use client';

import { useEffect, useRef, useState } from 'react';
import { startLocalPcmCapture, type LocalPcmCapture } from '@/modules/live-engine/core/local-pcm-capture';
import { prepareCapturedLocalAsrChunksInWorker } from '@/modules/live-engine/core/local-asr-worker-client';
import { loadLocalWhisperTiny, type LocalWhisperSession } from '@/modules/live-engine/core/whisper-tiny-client';
import type { WhisperLanguage } from '@/modules/live-engine/core/whisper-tiny-protocol';

type Phase = 'idle' | 'loading' | 'ready' | 'requesting' | 'recording';
type TranscriptWindow = {
  id: number;
  startMs: number;
  endMs: number;
  text: string;
  reviewedText: string;
  confirmed: boolean;
};
// Never silently discard unreviewed medical/legal utterances.
const MAX_UNREVIEWED_WINDOWS = 48;
const MAX_RETAINED_CONFIRMED_WINDOWS = 12;

interface WhisperWasmPanelProps {
  language: WhisperLanguage;
  microphoneBusy: boolean;
  onMicrophoneActive: (active: boolean) => void;
  onFinalTranscript: (text: string) => void;
}

/**
 * Experimental opt-in pilot. Never starts model downloads or microphone
 * capture automatically; no recording, backend inference or persistence.
 */
export default function WhisperWasmPanel({
  language, microphoneBusy, onMicrophoneActive, onFinalTranscript,
}: WhisperWasmPanelProps) {
  const [consent, setConsent] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<number | null>(null);
  const [windows, setWindows] = useState<TranscriptWindow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(false);

  const sessionRef = useRef<LocalWhisperSession | null>(null);
  const loadRef = useRef<AbortController | null>(null);
  const runRef = useRef<AbortController | null>(null);
  const captureRef = useRef<LocalPcmCapture | null>(null);
  const generationRef = useRef(0);
  const runIdRef = useRef(0);
  const nextWindowIdRef = useRef(0);
  const unreviewedCountRef = useRef(0);
  const confirmedWindowIdsRef = useRef(new Set<number>());
  const phaseRef = useRef<Phase>('idle');

  function setPhaseSafe(next: Phase) {
    phaseRef.current = next;
    setPhase(next);
  }

  useEffect(() => {
    setSupported(
      typeof window !== 'undefined' && window.isSecureContext &&
      typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined' &&
      typeof AudioWorkletNode !== 'undefined' && !!navigator.mediaDevices?.getUserMedia,
    );
    return () => {
      generationRef.current += 1;
      runIdRef.current += 1;
      loadRef.current?.abort();
      runRef.current?.abort();
      captureRef.current?.stop();
      sessionRef.current?.close();
      captureRef.current = null;
      sessionRef.current = null;
    };
  }, []);

  function stopCapture() {
    runIdRef.current += 1;
    runRef.current?.abort();
    runRef.current = null;
    captureRef.current?.stop();
    captureRef.current = null;
    // Abort the model Worker too: inference might otherwise keep the CPU busy
    // long after the microphone has stopped. Cached weights can be reloaded
    // with a new explicit action.
    sessionRef.current?.close();
    sessionRef.current = null;
    onMicrophoneActive(false);
    setPhaseSafe('idle');
  }

  function deactivate() {
    stopCapture();
    generationRef.current += 1;
    loadRef.current?.abort();
    loadRef.current = null;
    sessionRef.current?.close();
    sessionRef.current = null;
    setConsent(false);
    setProgress(null);
    setPhaseSafe('idle');
  }

  async function prepare() {
    if (!consent || !supported || phaseRef.current !== 'idle') return;
    const generation = ++generationRef.current;
    const controller = new AbortController();
    loadRef.current = controller;
    setError(null);
    setProgress(null);
    setPhaseSafe('loading');
    // This is intentionally only called in the user's button click.
    try {
      const session = await loadLocalWhisperTiny({
        language, signal: controller.signal,
        onProgress: (value) => {
          if (generation === generationRef.current) setProgress(value);
        },
      });
      if (generation !== generationRef.current || controller.signal.aborted) {
        session.close();
        return;
      }
      sessionRef.current = session;
      setPhaseSafe('ready');
    } catch {
      if (generation !== generationRef.current) return;
      setError('No se pudo preparar Whisper local. Verifica memoria, conectividad y compatibilidad del navegador.');
      setPhaseSafe('idle');
    } finally {
      if (generation === generationRef.current) loadRef.current = null;
    }
  }

  async function record() {
    if (microphoneBusy || phaseRef.current !== 'ready' || !sessionRef.current) return;
    const session = sessionRef.current;
    const runId = ++runIdRef.current;
    const controller = new AbortController();
    runRef.current = controller;
    let capture: LocalPcmCapture | null = null;
    setError(null);
    setPhaseSafe('requesting');
    onMicrophoneActive(true);
    try {
      capture = await startLocalPcmCapture({ signal: controller.signal });
      if (runId !== runIdRef.current || controller.signal.aborted) {
        capture.stop();
        return;
      }
      captureRef.current = capture;
      setPhaseSafe('recording');

      for await (const chunk of prepareCapturedLocalAsrChunksInWorker(capture, {
        chunkDurationMs: 10_000,
        overlapDurationMs: 1_000,
        signal: controller.signal,
      })) {
        if (runId !== runIdRef.current || controller.signal.aborted) break;
        const text = (await session.transcribe(chunk.samples, language)).trim();
        if (runId !== runIdRef.current || controller.signal.aborted) break;
        if (text) {
          // Do not append raw overlapping ASR output to "confirmed" text.
          // Human review is mandatory; dropping any unreviewed window when
          // memory limits are reached would silently lose spoken content.
          if (unreviewedCountRef.current >= MAX_UNREVIEWED_WINDOWS) {
            throw new Error('LOCAL_WHISPER_REVIEW_QUEUE_FULL');
          }
          unreviewedCountRef.current += 1;
          const id = ++nextWindowIdRef.current;
          setWindows((previous) => {
            const confirmed = previous.filter((item) => item.confirmed);
            const pending = previous.filter((item) => !item.confirmed);
            return [
              ...confirmed.slice(-MAX_RETAINED_CONFIRMED_WINDOWS),
              ...pending,
              {
                id,
                startMs: chunk.startMs,
                endMs: chunk.endMs,
                text,
                reviewedText: text,
                confirmed: false,
              },
            ];
          });
        }
      }
    } catch (cause) {
      if (runId !== runIdRef.current || controller.signal.aborted) return;
      const code = cause instanceof Error ? cause.message : '';
      setError(
        code === 'LOCAL_WHISPER_REVIEW_QUEUE_FULL'
          ? 'Hay demasiadas ventanas sin revisar. Se detuvo la captura para no descartar transcripciones pendientes.'
          : code.includes('OVERFLOW')
            ? 'Este equipo no alcanzó el ritmo del audio. Se detuvo la captura sin ocultar pérdida de voz.'
            : 'El reconocimiento local se detuvo. Comprueba permisos y capacidad de CPU/RAM.',
      );
    } finally {
      capture?.stop();
      if (runId === runIdRef.current) {
        captureRef.current = null;
        runRef.current = null;
        onMicrophoneActive(false);
        // If inference failed, release the model as well as the microphone.
        sessionRef.current?.close();
        sessionRef.current = null;
        setPhaseSafe('idle');
      }
    }
  }

  function updateReview(id: number, reviewedText: string) {
    if (confirmedWindowIdsRef.current.has(id)) return;
    setWindows((previous) => previous.map((window) =>
      window.id === id && !window.confirmed ? { ...window, reviewedText } : window,
    ));
  }

  function confirmReview(id: number) {
    if (confirmedWindowIdsRef.current.has(id)) return;
    const item = windows.find((window) => window.id === id && !window.confirmed);
    const reviewed = item?.reviewedText.trim();
    if (!reviewed) return;
    confirmedWindowIdsRef.current.add(id);
    unreviewedCountRef.current = Math.max(0, unreviewedCountRef.current - 1);
    setWindows((previous) => previous.map((window) =>
      window.id === id ? { ...window, confirmed: true } : window,
    ));
    onFinalTranscript(reviewed);
  }

  const active = phase === 'recording' || phase === 'requesting';
  return (
    <section className="mt-5 rounded-xl border border-amber-200 bg-amber-50/50 p-4"
      aria-label="Whisper local experimental">
      <h3 className="text-sm font-semibold text-slate-900">Whisper Tiny — alternativa WebAssembly experimental</h3>
      <p className="mt-1 text-xs leading-5 text-slate-700">
        Procesa español o inglés mediante CPU de este equipo. El primer uso descarga
        modelos públicos desde Hugging Face directamente al navegador y puede consumir
        bastante memoria y ancho de banda. Nunca se transmite el audio al servidor.
      </p>
      <p className="mt-1 text-xs font-medium text-amber-900">
        No apto aún para interpretación profesional en tiempo real. Los fragmentos se solapan
        y pueden repetir palabras. Nada se añade al texto confirmado o a TXT hasta que
        revises manualmente cada ventana, especialmente dosis, negaciones y cifras.
      </p>
      {!supported && (
        <p role="status" className="mt-3 text-sm text-red-700">
          Este dispositivo no ofrece los requisitos de micrófono, AudioWorklet, Worker y WebAssembly para este piloto.
        </p>
      )}
      {phase === 'idle' && supported && (
        <label className="mt-3 flex items-start gap-2 text-sm text-slate-800">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)}
            className="mt-1" />
          Autorizo descargar los archivos del modelo al navegador. Entiendo que se trata de
          una herramienta experimental y que la descarga puede usar muchos datos.
        </label>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {phase === 'idle' && (
          <button type="button" onClick={() => { void prepare(); }}
            disabled={!consent || !supported}
            className="rounded-lg border border-amber-400 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50">
            Descargar y preparar Whisper local
          </button>
        )}
        {phase === 'ready' && (
          <button type="button" onClick={() => { void record(); }} disabled={microphoneBusy}
            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
            Iniciar transcripción Whisper
          </button>
        )}
        {active && (
          <button type="button" onClick={stopCapture}
            className="rounded-lg border border-amber-500 px-3 py-2 text-sm font-semibold">
            Detener audio y liberar modelo
          </button>
        )}
        {phase !== 'idle' && (
          <button type="button" onClick={deactivate}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold">
            {phase === 'loading' ? 'Cancelar descarga' : 'Liberar modelo'}
          </button>
        )}
      </div>
      <p role="status" className="mt-2 text-xs text-slate-600">
        {phase === 'idle' ? 'Modelo no cargado.' :
          phase === 'loading' ? 'Preparando modelo local' + (progress !== null ? ' · ' + progress + '%' : '…') :
          phase === 'ready' ? 'Modelo preparado en este equipo.' :
          phase === 'requesting' ? 'Esperando autorización del micrófono…' :
          'Micrófono activo; procesando fragmentos de 10 segundos. Revisa cada ventana.'}
      </p>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      {windows.length > 0 && (
        <div className="mt-3 max-h-72 overflow-y-auto rounded-lg bg-white p-3 text-xs text-slate-700">
          <p className="mb-2 font-semibold">Ventanas pendientes de revisión humana</p>
          {windows.map((item) => (
            <div className="mt-3 border-t border-slate-200 pt-2" key={item.id}>
              <p className="font-medium">
                {Math.floor(item.startMs / 1000)}–{Math.floor(item.endMs / 1000)} s
                {item.confirmed ? ' · Revisada y añadida' : ' · Pendiente'}
              </p>
              {item.confirmed ? (
                <p className="mt-1 whitespace-pre-wrap">{item.reviewedText}</p>
              ) : (
                <>
                  <label htmlFor={'review-whisper-' + item.id}
                    className="mt-2 block font-medium">
                    Revisar y corregir texto de esta ventana
                  </label>
                  <textarea id={'review-whisper-' + item.id}
                    value={item.reviewedText}
                    onChange={(event) => updateReview(item.id, event.target.value)}
                    rows={2} maxLength={8000}
                    className="mt-1 w-full rounded border border-slate-300 bg-white p-2"
                  />
                  <button type="button"
                    onClick={() => confirmReview(item.id)}
                    disabled={!item.reviewedText.trim()}
                    className="mt-2 rounded border border-slate-400 px-3 py-2 font-semibold disabled:opacity-50">
                    Añadir texto revisado a la transcripción confirmada
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
