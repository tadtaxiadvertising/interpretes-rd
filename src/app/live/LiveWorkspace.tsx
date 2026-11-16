'use client';

import { useEffect, useRef, useState } from 'react';
import { acquireMicrophone, releaseMicrophone } from '@/modules/live-engine/core/audio-capture';
import { detectDeviceCapabilities, type DeviceCapabilities } from '@/modules/live-engine/core/contracts';

type MicState = 'idle' | 'requesting' | 'active' | 'error';

export default function LiveWorkspace() {
  const streamRef = useRef<MediaStream | null>(null);
  // Invalidates pending permission requests on cancellation or unmount.
  const requestIdRef = useRef(0);
  const [micState, setMicState] = useState<MicState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<DeviceCapabilities | null>(null);

  useEffect(() => {
    setCapabilities(detectDeviceCapabilities());
    return () => {
      requestIdRef.current += 1;
      releaseMicrophone(streamRef.current);
      streamRef.current = null;
    };
  }, []);

  async function toggleMicrophone() {
    if (micState === 'active' || micState === 'requesting') {
      // Permissions dialogs cannot be aborted, but late streams are stopped.
      requestIdRef.current += 1;
      releaseMicrophone(streamRef.current);
      streamRef.current = null;
      setMicState('idle');
      return;
    }

    const requestId = ++requestIdRef.current;
    setError(null);
    setMicState('requesting');
    try {
      const stream = await acquireMicrophone();
      if (requestId !== requestIdRef.current) {
        releaseMicrophone(stream);
        return;
      }
      streamRef.current = stream;
      setMicState('active');
    } catch (cause) {
      if (requestId !== requestIdRef.current) return;
      const message = cause instanceof Error ? cause.message : 'MICROPHONE_ACCESS_FAILED';
      setError(message);
      setMicState('error');
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-8">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-600">Free Interpreters</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Live</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
          Espacio de trabajo de audio con procesamiento local como opción predeterminada.
          Esta primera fase comprueba el micrófono y las capacidades del navegador; todavía no
          transcribe ni traduce conversaciones.
        </p>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Entrada de audio</h2>
            <p className="mt-1 text-sm text-slate-600">El audio permanece en esta pestaña y no se guarda ni se envía.</p>
          </div>
          <button
            type="button"
            onClick={toggleMicrophone}
            className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            {micState === 'requesting' ? 'Cancelar solicitud' : micState === 'active' ? 'Detener micrófono' : 'Probar micrófono'}
          </button>
        </div>

        <div className="mt-5 flex items-center gap-3 rounded-xl bg-slate-50 p-4">
          <span className={`h-3 w-3 rounded-full ${micState === 'active' ? 'bg-emerald-500' : micState === 'error' ? 'bg-red-500' : 'bg-slate-300'}`} />
          <p className="text-sm font-medium text-slate-700">
            {micState === 'active' ? 'Micrófono activo en este dispositivo' : micState === 'requesting' ? 'Esperando autorización del navegador' : micState === 'error' ? 'No se pudo acceder al micrófono' : 'Micrófono detenido'}
          </p>
        </div>
        {error && <p role="alert" className="mt-3 text-sm text-red-700">Detalle: {error}</p>}
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Capacidad del dispositivo</h2>
        <p className="mt-1 text-sm text-slate-600">La selección de modelos se adaptará a estas capacidades en las siguientes fases.</p>
        {capabilities ? (
          <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Capability label="Acceso a micrófono" value={capabilities.mediaDevices ? 'Disponible' : 'No disponible'} />
            <Capability label="WebAssembly" value={capabilities.webAssembly ? 'Disponible' : 'No disponible'} />
            <Capability label="AudioWorklet" value={capabilities.audioWorklet ? 'Disponible' : 'No disponible'} />
            <Capability label="WebGPU" value={capabilities.webGPU ? 'Disponible' : 'No disponible'} />
            <Capability label="Memoria estimada" value={capabilities.estimatedDeviceMemoryGb ? `≈ ${capabilities.estimatedDeviceMemoryGb} GB` : 'No informada'} />
            <Capability label="Núcleos lógicos" value={String(capabilities.hardwareConcurrency)} />
          </dl>
        ) : <p className="mt-4 text-sm text-slate-500">Detectando capacidades…</p>}
      </section>

      <section className="mt-6 rounded-2xl border border-blue-100 bg-blue-50/60 p-5">
        <h2 className="font-semibold text-slate-900">Privacidad y proveedores externos</h2>
        <p className="mt-1 text-sm leading-6 text-slate-700">
          Los proveedores externos estarán desactivados hasta que el intérprete elija uno,
          revise qué datos salen del dispositivo y otorgue consentimiento específico para
          transcripción o traducción. No se solicitarán ni almacenarán claves API en el servidor.
        </p>
      </section>
    </div>
  );
}

function Capability({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-100 p-4">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-slate-900">{value}</dd>
    </div>
  );
}
