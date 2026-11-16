'use client';

import { useEffect, useRef, useState } from 'react';
import {
  checkOnDeviceSpeechPack,
  installOnDeviceSpeechPack,
  startOnDeviceSpeech,
  supportsOnDeviceSpeech,
  type LocalSpeechLanguage,
  type LocalSpeechPackStatus,
  type LocalSpeechSession,
} from '@/modules/live-engine/core/browser-local-speech';
import { downloadLocalTranscript } from '@/modules/live-engine/core/export-local-transcript';

export default function LocalSpeechPanel() {
  const [language, setLanguage] = useState<LocalSpeechLanguage>('es-ES');
  const [status, setStatus] = useState<LocalSpeechPackStatus | 'checking' | 'installing' | null>(null);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<LocalSpeechSession | null>(null);
  const requestRef = useRef(0);

  useEffect(() => () => {
    requestRef.current += 1;
    sessionRef.current?.stop();
    sessionRef.current = null;
  }, []);

  function stop() {
    requestRef.current += 1;
    sessionRef.current?.stop();
    sessionRef.current = null;
    setListening(false);
    setInterim('');
  }

  function changeLanguage(next: LocalSpeechLanguage) {
    stop();
    setLanguage(next);
    setStatus(null);
    setTranscript('');
    setError(null);
  }

  async function check() {
    const token = ++requestRef.current;
    setStatus('checking');
    setError(null);
    try {
      const result = await checkOnDeviceSpeechPack(language);
      if (token === requestRef.current) setStatus(result);
    } catch {
      if (token === requestRef.current) {
        setStatus('unavailable');
        setError('El navegador no pudo verificar el paquete de idioma local.');
      }
    }
  }

  async function install() {
    const token = ++requestRef.current;
    setStatus('installing');
    setError(null);
    try {
      const installed = await installOnDeviceSpeechPack(language);
      if (token !== requestRef.current) return;
      setStatus(installed ? 'available' : 'unavailable');
      if (!installed) setError('La instalación local no se completó.');
    } catch {
      if (token === requestRef.current) {
        setStatus('unavailable');
        setError('El navegador no pudo instalar el paquete local.');
      }
    }
  }

  function start() {
    if (status !== 'available' || !supportsOnDeviceSpeech()) return;
    stop();
    const token = requestRef.current;
    setError(null);
    try {
      sessionRef.current = startOnDeviceSpeech(
        language,
        (text, isFinal) => {
          if (token !== requestRef.current) return;
          if (isFinal) {
            setTranscript((previous) => previous ? previous + ' ' + text : text);
            setInterim('');
          } else setInterim(text);
        },
        (message) => {
          if (token !== requestRef.current) return;
          // Browser errors can terminate recognition without a reliable end event.
          // Release the recognizer and update UI immediately; never auto-retry
          // through a cloud-backed recognizer.
          stop();
          setError('Reconocimiento local: ' + message);
        },
        () => {
          if (token !== requestRef.current) return;
          sessionRef.current = null;
          setListening(false);
          setInterim('');
        },
      );
      setListening(true);
    } catch {
      setListening(false);
      setError('No se pudo iniciar el reconocimiento local. Verifica los permisos del micrófono.');
    }
  }

  function exportFinalText() {
    try {
      downloadLocalTranscript({ transcript, language, createdAt: new Date() });
    } catch {
      setError('No fue posible descargar el texto desde este navegador.');
    }
  }

  const busy = status === 'checking' || status === 'installing';
  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">Transcripción local experimental</h2>
      <p className="mt-1 text-sm leading-6 text-slate-600">
        Reconocimiento en el dispositivo sin enviar audio a Free Interpreters ni a servicios de voz externos.
        Solo se activa si el navegador confirma explícitamente el procesamiento local.
        No traduce ni garantiza precisión profesional.
      </p>
      <div className="mt-5 flex flex-wrap items-end gap-3">
        <label className="text-sm font-medium text-slate-700">
          Idioma
          <select
            value={language}
            onChange={(event) => changeLanguage(event.target.value as LocalSpeechLanguage)}
            className="mt-1 block rounded-lg border border-slate-300 bg-white px-3 py-2"
          >
            <option value="es-ES">Español</option>
            <option value="en-US">English</option>
          </select>
        </label>
        <button type="button" onClick={check} disabled={busy || listening}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50">
          Comprobar idioma local
        </button>
        {(status === 'downloadable' || status === 'downloading') && (
          <button type="button" onClick={install} disabled={busy || listening}
            className="rounded-lg border border-blue-300 px-4 py-2 text-sm font-semibold text-blue-800 disabled:opacity-50">
            Instalar paquete de idioma
          </button>
        )}
        {status === 'available' && (
          <button type="button" onClick={listening ? stop : start}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
            {listening ? 'Detener transcripción' : 'Iniciar transcripción local'}
          </button>
        )}
      </div>
      <p role="status" className="mt-4 text-sm text-slate-600">
        {status === null ? 'Comprueba la disponibilidad antes de iniciar.' :
         status === 'checking' ? 'Comprobando compatibilidad…' :
         status === 'installing' ? 'Instalando paquete local…' :
         status === 'available' ? (listening ? 'Escuchando y transcribiendo en este dispositivo.' : 'Paquete local disponible.') :
         status === 'downloadable' ? 'Paquete disponible para instalar en el navegador.' :
         status === 'downloading' ? 'El navegador está descargando el paquete.' :
         status === 'unsupported' ? 'Este navegador no ofrece reconocimiento local compatible.' :
         'Idioma o paquete local no disponible.'}
      </p>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      <div className="mt-4 min-h-24 whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-sm text-slate-800"
        aria-label="Transcripción en este dispositivo">
        {transcript}{interim && <span className="text-slate-500"> {interim}</span>}
        {!transcript && !interim && <span className="text-slate-500">La transcripción aparecerá aquí. No se guardará automáticamente.</span>}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        {transcript.trim() && (
          <button type="button" onClick={exportFinalText}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800">
            Descargar TXT (texto confirmado)
          </button>
        )}
        {(transcript || interim) && (
          <button type="button" onClick={() => { setTranscript(''); setInterim(''); }}
            className="text-sm font-semibold text-slate-700 underline">Limpiar texto local</button>
        )}
      </div>
    </section>
  );
}
