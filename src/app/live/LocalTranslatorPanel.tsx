'use client';

import { useEffect, useRef, useState } from 'react';
import {
  checkLocalTranslation,
  createLocalTranslator,
  type LocalTranslationLanguage,
  type LocalTranslationStatus,
  type LocalTranslatorSession,
} from '@/modules/live-engine/core/browser-local-translation';

interface LocalTranslatorPanelProps {
  sourceLanguage: LocalTranslationLanguage;
  finalTranscript: string;
}

export default function LocalTranslatorPanel({ sourceLanguage, finalTranscript }: LocalTranslatorPanelProps) {
  const targetLanguage: LocalTranslationLanguage = sourceLanguage === 'es' ? 'en' : 'es';
  const direction = sourceLanguage === 'es'
    ? ({ sourceLanguage: 'es', targetLanguage: 'en' } as const)
    : ({ sourceLanguage: 'en', targetLanguage: 'es' } as const);
  const [status, setStatus] = useState<LocalTranslationStatus | 'checking' | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [ready, setReady] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<LocalTranslatorSession | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const translationIdRef = useRef(0);
  const translationAbortRef = useRef<AbortController | null>(null);

  useEffect(() => () => {
    generationRef.current += 1;
    translationIdRef.current += 1;
    translationAbortRef.current?.abort();
    abortRef.current?.abort();
    sessionRef.current?.close();
    abortRef.current = null;
    sessionRef.current = null;
  }, []);

  function deactivate() {
    generationRef.current += 1;
    translationIdRef.current += 1;
    translationAbortRef.current?.abort();
    translationAbortRef.current = null;
    abortRef.current?.abort();
    sessionRef.current?.close();
    abortRef.current = null;
    sessionRef.current = null;
    setReady(false);
    setPreparing(false);
    setTranslating(false);
    setProgress(null);
    setOutput('');
  }

  async function check() {
    const token = ++generationRef.current;
    setStatus('checking');
    setError(null);
    try {
      const result = await checkLocalTranslation(direction);
      if (token === generationRef.current) setStatus(result);
    } catch {
      if (token !== generationRef.current) return;
      setStatus('unavailable');
      setError('No se pudo verificar la compatibilidad de traducción local.');
    }
  }

  function activate() {
    if (preparing || ready || !status || !['available', 'downloadable', 'downloading'].includes(status)) return;
    const token = ++generationRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setPreparing(true);
    setError(null);
    setProgress(null);

    // Important: initiate Translator.create() synchronously in the button click
    // before any await, because the browser requires transient user activation.
    void createLocalTranslator(direction, {
      signal: controller.signal,
      onDownloadProgress: (fraction) => {
        if (token === generationRef.current) setProgress(Math.round(fraction * 100));
      },
    }).then(session => {
      if (token !== generationRef.current || controller.signal.aborted) {
        session.close();
        return;
      }
      sessionRef.current = session;
      setPreparing(false);
      setReady(true);
    }).catch(() => {
      if (token !== generationRef.current) return;
      setPreparing(false);
      setError('El navegador no pudo activar el traductor local para este par de idiomas.');
    });
  }

  async function translate() {
    const session = sessionRef.current;
    const text = input.trim();
    if (!session || translating) return;
    if (!text || text.length > 1800) {
      setError('Introduce entre 1 y 1,800 caracteres.');
      return;
    }
    const token = generationRef.current;
    const translationId = ++translationIdRef.current;
    translationAbortRef.current?.abort();
    const controller = new AbortController();
    translationAbortRef.current = controller;
    setTranslating(true);
    setError(null);
    setOutput('');
    try {
      const translated = await session.translate(text, controller.signal);
      if (token === generationRef.current && translationId === translationIdRef.current && !controller.signal.aborted) setOutput(translated);
    } catch {
      if (token === generationRef.current && translationId === translationIdRef.current && !controller.signal.aborted) {
        setError('No se pudo traducir localmente. Comprueba el idioma y la cuota del navegador.');
      }
    } finally {
      if (translationAbortRef.current === controller) translationAbortRef.current = null;
      if (token === generationRef.current && translationId === translationIdRef.current) setTranslating(false);
    }
  }

  function invalidateTranslation() {
    translationIdRef.current += 1;
    translationAbortRef.current?.abort();
    translationAbortRef.current = null;
    setTranslating(false);
    setOutput('');
  }

  function loadFinalTranscript() {
    const final = finalTranscript.trim();
    if (!final) return;
    const tail = final.slice(-1800);
    invalidateTranslation();
    setInput(tail);
    setError(final.length > 1800
      ? 'Solo se cargaron los últimos 1,800 caracteres. Puedes editar el texto antes de traducir.'
      : null);
  }

  const canActivate = status === 'available' || status === 'downloadable' || status === 'downloading';
  return (
    <section className="mt-5 rounded-xl border border-blue-100 bg-blue-50/40 p-4" aria-label="Traducción local opcional">
      <h3 className="font-semibold text-slate-900">Traducción local {sourceLanguage.toUpperCase()} → {targetLanguage.toUpperCase()} (experimental)</h3>
      <p className="mt-1 text-sm text-slate-600">
        El texto se traduce en tu dispositivo cuando el navegador ofrece la API.
        Al activarla, el navegador puede descargar modelos lingüísticos; no enviamos la conversación
        a Free Interpreters ni activamos un servicio externo de traducción.
      </p>
      <p className="mt-1 text-xs text-amber-800">
        Es una ayuda orientativa: verifica negaciones, dosis, nombres y cifras antes de usarla en interpretación profesional.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={check} disabled={preparing || ready || status === 'checking'}
          className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-blue-900 disabled:opacity-50">
          Comprobar traducción local
        </button>
        {canActivate && !ready && (
          <button type="button" onClick={activate} disabled={preparing}
            className="rounded-lg bg-blue-800 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {preparing ? 'Preparando modelo local…' : status === 'available' ? 'Activar traducción local' : 'Descargar y activar modelo local'}
          </button>
        )}
        {(preparing || ready) && (
          <button type="button" onClick={deactivate}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800">
            {preparing ? 'Cancelar activación' : 'Desactivar traductor'}
          </button>
        )}
      </div>
      <p role="status" className="mt-2 text-sm text-slate-600">
        {status === null ? 'Comprueba primero si tu navegador admite este par de idiomas.' :
         status === 'checking' ? 'Comprobando compatibilidad…' :
         status === 'unsupported' ? 'Este navegador no admite la traducción local.' :
         status === 'unavailable' ? 'La traducción local para este par no está disponible.' :
         ready ? 'Traductor local listo.' :
         preparing ? `Preparando en el navegador${progress === null ? '…' : ` · ${progress}%`}` :
         status === 'available' ? 'Modelo local disponible para activar.' :
         'El navegador deberá descargar el modelo si decides activarlo.'}
      </p>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      <div className="mt-4">
        <label htmlFor="live-local-translation-input" className="block text-sm font-medium text-slate-700">Texto para traducir</label>
        <textarea id="live-local-translation-input" value={input}
          onChange={(event) => { invalidateTranslation(); setInput(event.target.value); }}
          maxLength={1800} rows={3}
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-900"
          placeholder="Escribe o carga una transcripción final para traducirla localmente." />
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={loadFinalTranscript} disabled={!finalTranscript.trim()}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium disabled:opacity-50">
            Cargar transcripción confirmada
          </button>
          <button type="button" onClick={() => { void translate(); }}
            disabled={!ready || translating || !input.trim()}
            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {translating ? 'Traduciendo localmente…' : 'Traducir en este equipo'}
          </button>
        </div>
      </div>
      {output && (
        <div className="mt-3 rounded-lg border border-blue-100 bg-white p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Traducción orientativa</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-900">{output}</p>
        </div>
      )}
    </section>
  );
}
