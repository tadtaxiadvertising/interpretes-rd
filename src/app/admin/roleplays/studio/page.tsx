'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, AudioLines, Download, Plus, Trash2 } from 'lucide-react';
import { ROLEPLAY_MAX_SCENARIOS, ROLEPLAY_RESPONSE_MAX_DURATION_SEC } from '@/lib/roleplay-limits';
import { parseTimedTranscript, toPublishableStudioSegments } from '@/lib/roleplay-studio/transcript';
import StudioWaveform from './StudioWaveform';
import {
  createStudioDraft, openStudioDraft, sha256StudioAudio, MAX_STUDIO_DRAFT_CHARS,
} from '@/lib/roleplay-studio/draft';
import {
  classifySpeakerRole, filterInterpreterCues, makeNeutralSegmentTitle,
  type StudioLanguage, type StudioSpeakerRole,
} from '@/lib/roleplay-studio/speaker-profiles';

type Segment = {
  id: string;
  title: string;
  start: number;
  end: number;
  scriptPrompt: string;
  responseLimit: number;
  speakerRole: StudioSpeakerRole;
  language: StudioLanguage;
};

function formatTime(value: number): string {
  const safe = Math.max(0, value);
  const minutes = Math.floor(safe / 60);
  const seconds = safe - minutes * 60;
  return String(minutes).padStart(2, '0') + ':' + seconds.toFixed(1).padStart(4, '0');
}

export default function RoleplayStudioPage() {
  const [audio, setAudio] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [duration, setDuration] = useState(0);
  const [playhead, setPlayhead] = useState(0);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [busy, setBusy] = useState(false);
  const [draftBusy, setDraftBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [captionTexts, setCaptionTexts] = useState<Record<string, string>>({});
  const [excludeInterpreter, setExcludeInterpreter] = useState(true);
  const player = useRef<HTMLAudioElement>(null);
  const previewEnd = useRef<number | null>(null);
  const subtitleImportRevision = useRef(0);
  const draftOperationRevision = useRef(0);
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  const stopPreview = () => {
    previewEnd.current = null;
    setPreviewingId(null);
    player.current?.pause();
  };

  const seekAudio = (seconds: number) => {
    const audioPlayer = player.current;
    if (!audioPlayer || !Number.isFinite(seconds) || !duration) return;
    const timestamp = Math.min(duration, Math.max(0, seconds));
    // Seeking manually exits a clip preview; its previous end must not stop
    // the administrator when inspecting another timestamp.
    previewEnd.current = null;
    setPreviewingId(null);
    audioPlayer.currentTime = timestamp;
    setPlayhead(timestamp);
  };

  const markAtPlayhead = (id: string, boundary: 'start' | 'end') => {
    const position = player.current?.currentTime;
    if (position === undefined || !Number.isFinite(position) || !duration) return;
    const timestamp = Math.min(duration, Math.max(0, Number(position.toFixed(2))));
    update(id, { [boundary]: timestamp });
  };

  const previewSegment = (segment: Segment) => {
    const audioPlayer = player.current;
    if (!audioPlayer || !Number.isFinite(segment.start) || !Number.isFinite(segment.end) ||
      segment.end <= segment.start || segment.start < 0 || segment.end > duration) return;
    if (previewingId === segment.id) {
      stopPreview();
      return;
    }
    // Seek directly even if audio is already playing. Calling pause() here
    // schedules an onPause event which can clear the new segment's end marker.
    audioPlayer.currentTime = segment.start;
    previewEnd.current = segment.end;
    setPreviewingId(segment.id);
    void audioPlayer.play().catch(() => {
      previewEnd.current = null;
      setPreviewingId(null);
      setError('No fue posible reproducir el fragmento.');
    });
  };

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  const chooseAudio = (file: File | undefined) => {
    // Invalidate any in-flight SRT/VTT read bound to the previous audio.
    subtitleImportRevision.current += 1;
    draftOperationRevision.current += 1;
    stopPreview();
    setError('');
    setNotice('');
    setSegments([]);
    setCaptionTexts({});
    setDuration(0);
    setPlayhead(0);
    setDraftBusy(false);
    if (!file) { setAudio(null); setUrl(''); return; }
    if (!/\.mp3$/i.test(file.name) || file.size < 1 || file.size > 15 * 1024 * 1024) {
      setError('Selecciona un MP3 válido de hasta 15 MiB.');
      setAudio(null);
      setUrl('');
      return;
    }
    setAudio(file);
    setUrl(URL.createObjectURL(file));
  };

  const importSubtitles = async (file: File) => {
    if (!audio || !duration) return;
    const revision = ++subtitleImportRevision.current;
    setError('');
    setNotice('');
    try {
      if (!/\.(srt|vtt)$/i.test(file.name) || file.size < 1 || file.size > 1_000_000) {
        throw new Error('Selecciona un SRT o VTT de hasta 1 MB.');
      }
      const transcript = await file.text();
      // The file may have changed, or a newer import/edit may have started.
      if (revision !== subtitleImportRevision.current) return;
      const cues = parseTimedTranscript(transcript);
      const { selected, excludedCount } = filterInterpreterCues(cues, excludeInterpreter);
      if (!selected.length) {
        throw new Error('No quedan intervenciones del médico o paciente después de excluir las del intérprete.');
      }
      if (selected.some(cue => cue.end > duration + 0.1)) {
        throw new Error('Los subtítulos contienen intervalos posteriores al final de la grabación.');
      }
      // Only the intervals and labels are used for publication. The subtitle
      // text is local-only reference material, never copied into scriptPrompt.
      const prepared: Segment[] = toPublishableStudioSegments(selected).map((segment, index) => ({
        ...segment,
        id: crypto.randomUUID(),
        speakerRole: classifySpeakerRole(selected[index].speaker),
        language: 'unknown',
      }));
      setSegments(prepared);
      setCaptionTexts(Object.fromEntries(prepared.map((segment, index) => [segment.id, selected[index].text])));
      setNotice(`${prepared.length} intervenciones importadas. ${excludedCount} del intérprete original omitidas automáticamente. Revisa los roles e idiomas antes de exportar.`);
    } catch (cause) {
      if (revision !== subtitleImportRevision.current) return;
      setError(cause instanceof Error ? cause.message : 'No fue posible leer el archivo de subtítulos.');
    }
  };

  const addSegment = () => {
    subtitleImportRevision.current += 1;
    const start = segments.length > 0
      ? Math.max(...segments.map(segment => Number.isFinite(segment.end) ? segment.end : 0))
      : (player.current?.currentTime || 0);
    const end = Math.min(duration, start + 30);
    if (segments.length >= ROLEPLAY_MAX_SCENARIOS || end - start < 0.1) return;
    setSegments(prev => [...prev, {
      id: crypto.randomUUID(), title: 'Intervención ' + (prev.length + 1),
      start: Number(start.toFixed(2)), end: Number(end.toFixed(2)),
      scriptPrompt: '', responseLimit: 120, speakerRole: 'unknown', language: 'unknown',
    }]);
  };

  const update = (id: string, patch: Partial<Segment>) => {
    subtitleImportRevision.current += 1;
    setSegments(prev => prev.map(segment => segment.id === id ? { ...segment, ...patch } : segment));
  };

  const saveDraft = async () => {
    if (!audio || !duration || busy || draftBusy) return;
    const revision = subtitleImportRevision.current;
    const operation = ++draftOperationRevision.current;
    const snapshot = [...segments];
    setDraftBusy(true);
    setError('');
    setNotice('');
    try {
      const digest = await sha256StudioAudio(audio);
      if (revision !== subtitleImportRevision.current) return;
      const draft = createStudioDraft(audio.size, digest, snapshot, duration);
      const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' });
      if (blob.size > MAX_STUDIO_DRAFT_CHARS) {
        throw new Error('El proyecto supera 180 KB. Reduce las instrucciones antes de guardarlo.');
      }
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = 'roleplay-studio-proyecto.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 30000);
      setNotice('Proyecto guardado localmente. Conserva también el MP3 original; el JSON no contiene audio ni transcripción.');
    } catch (cause) {
      if (revision === subtitleImportRevision.current) {
        setError(cause instanceof Error ? cause.message : 'No fue posible guardar el proyecto.');
      }
    } finally {
      if (operation === draftOperationRevision.current) setDraftBusy(false);
    }
  };

  const openDraftFile = async (file: File) => {
    if (!audio || !duration || busy || draftBusy) return;
    const revision = ++subtitleImportRevision.current;
    const operation = ++draftOperationRevision.current;
    setDraftBusy(true);
    setError('');
    setNotice('');
    try {
      if (!/\.json$/i.test(file.name) || file.size < 1 || file.size > MAX_STUDIO_DRAFT_CHARS) {
        throw new Error('Selecciona un proyecto JSON de Audio Studio de hasta 180 KB.');
      }
      const json = await file.text();
      if (revision !== subtitleImportRevision.current) return;
      const digest = await sha256StudioAudio(audio);
      if (revision !== subtitleImportRevision.current) return;
      const restored = openStudioDraft(json, audio.size, digest, duration);
      setSegments(restored.map(segment => ({ ...segment, id: crypto.randomUUID() })));
      setCaptionTexts({});
      setNotice(`Proyecto verificado con SHA-256 y restaurado: ${restored.length} intervenciones. La transcripción no forma parte del borrador.`);
    } catch (cause) {
      if (revision === subtitleImportRevision.current) {
        setError(cause instanceof Error ? cause.message : 'No se pudo abrir el proyecto.');
      }
    } finally {
      if (operation === draftOperationRevision.current) setDraftBusy(false);
    }
  };

  const exportPackage = async () => {
    if (!audio || !duration || !segments.length) return;
    setError('');
    setNotice('');
    if (segments.some(segment => segment.speakerRole === 'interpreter')) {
      setError('Hay intervenciones etiquetadas como Intérprete. Elimina esos fragmentos antes de exportar un roleplay para candidatos o intérpretes.');
      return;
    }
    const ordered = [...segments].sort((a, b) => a.start - b.start);
    let end = 0;
    let total = 0;
    for (const segment of ordered) {
      if (!segment.title.trim() || segment.title.length > 200 ||
        !Number.isFinite(segment.start) || !Number.isFinite(segment.end) ||
        segment.start < end || segment.end <= segment.start ||
        segment.end > duration + 0.1 || segment.end - segment.start > 300 ||
        segment.scriptPrompt.length > 5000 ||
        !Number.isInteger(segment.responseLimit) || segment.responseLimit < 0 ||
        segment.responseLimit > ROLEPLAY_RESPONSE_MAX_DURATION_SEC) {
        setError('Corrige las intervenciones: orden, títulos, duración máxima de 5 minutos y ausencia de solapamientos.');
        return;
      }
      end = segment.end;
      total += segment.end - segment.start;
    }
    if (total > 900) {
      setError('El paquete no puede superar 15 minutos de audio acumulado.');
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append('audio', audio);
      form.append('segments', JSON.stringify(ordered.map(segment => ({
        title: segment.title, start: segment.start, end: segment.end,
        scriptPrompt: segment.scriptPrompt, responseLimit: segment.responseLimit,
      }))));
      const response = await fetch('/api/admin/roleplays/studio/export', {
        method: 'POST', credentials: 'same-origin', body: form,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || 'No se pudo exportar.');
      }
      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = 'roleplay-studio.zip';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 30000);
      setNotice('Paquete generado. Ve a Crear roleplay, importa directamente este ZIP y elige el candidato o intérprete destinatario.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Error al preparar el paquete.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/admin/roleplays" className="mb-3 inline-flex items-center gap-2 text-sm text-blue-300"><ArrowLeft size={16} /> Volver a roleplays</Link>
          <h1 className="text-3xl font-bold text-white">Roleplay Audio Studio</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            Prepara intervenciones desde una grabación MP3 sin crear sesiones ni modificar audios publicados.
            Los paquetes se importan después desde el formulario administrativo, donde se asignan a candidatos o intérpretes.
          </p>
        </div>
        <Link href="/admin/roleplays/new" className="rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-500">Importar y asignar</Link>
      </header>
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <label htmlFor="studio-audio" className="block text-sm font-semibold text-white">Grabación original MP3 (máximo 15 MiB)</label>
        <input id="studio-audio" type="file" accept=".mp3,audio/mpeg" className="mt-3 block w-full text-sm text-slate-300" onChange={event => chooseAudio(event.currentTarget.files?.[0])} />
        {url && (
          <div className="mt-5 space-y-3">
            <audio ref={player} src={url} controls preload="metadata" className="w-full"
              onLoadedMetadata={event => {
                const length = event.currentTarget.duration;
                setDuration(Number.isFinite(length) ? length : 0);
                if (!Number.isFinite(length) || length <= 0) setError('No se pudo determinar la duración de este MP3.');
              }}
              onTimeUpdate={event => {
                setPlayhead(event.currentTarget.currentTime);
                if (previewEnd.current !== null &&
                    event.currentTarget.currentTime >= previewEnd.current) stopPreview();
              }}
              onPause={() => {
                previewEnd.current = null;
                setPreviewingId(null);
              }}
              onEnded={() => {
                previewEnd.current = null;
                setPreviewingId(null);
              }} />
            {audio && duration > 0 && (
              <StudioWaveform
                file={audio}
                duration={duration}
                currentTime={playhead}
                segments={segments}
                onSeek={seekAudio}
              />
            )}
            <p className="text-sm text-slate-400">Duración: {formatTime(duration)} · Navega con la línea de tiempo y usa “Marcar inicio” / “Marcar fin” para fijar cada intervención.</p>
            <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
              <label htmlFor="studio-transcript" className="block text-sm font-semibold text-blue-100">
                Opcional: importar tiempos de transcripción SRT / WebVTT
              </label>
              <input id="studio-transcript" type="file" accept=".srt,.vtt,text/vtt,application/x-subrip"
                className="mt-2 block w-full text-sm text-slate-300"
                onChange={event => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = '';
                  if (file) void importSubtitles(file);
                }}/>
              <label className="mt-3 flex items-center gap-2 text-sm text-slate-200">
                <input type="checkbox" checked={excludeInterpreter}
                  onChange={event => {
                    subtitleImportRevision.current += 1;
                    setExcludeInterpreter(event.currentTarget.checked);
                  }}
                  className="h-4 w-4 accent-blue-500"/>
                Excluir intervenciones del intérprete original al importar
              </label>
              <p className="mt-2 text-xs text-slate-400">
                El filtro solo reconoce etiquetas genéricas exactas (por ejemplo, Interpreter o Intérprete).
                Revisa manualmente cualquier hablante desconocido. Se importan los tiempos y solo las etiquetas genéricas de rol (Médico, Paciente, etc.).
                Los nombres personales se reemplazan por títulos neutrales. La transcripción se muestra
                únicamente aquí y no se envía al participante. Revisa y excluye las intervenciones del intérprete.
              </p>
            </div>
          </div>
        )}
      </section>
      {audio && duration > 0 && (
        <section className="space-y-3 rounded-2xl border border-indigo-400/20 bg-indigo-400/5 p-5">
          <h2 className="text-lg font-bold text-white">Proyecto de edición</h2>
          <p className="text-sm leading-6 text-slate-300">
            Guarda y recupera los cortes y perfiles sin volver a empezar. El proyecto JSON
            se verifica contra el MP3 original mediante SHA-256; no guarda el audio
            ni las transcripciones. Sí incluye los títulos e instrucciones que hayas redactado,
            por lo que debes protegerlo si contiene información sensible.
          </p>
          <div className="flex flex-wrap items-end gap-4">
            <button type="button" onClick={() => void saveDraft()}
              disabled={busy || draftBusy}
              className="rounded-xl border border-indigo-300/30 bg-indigo-500/20 px-4 py-2 text-sm font-semibold text-indigo-100 disabled:opacity-50">
              {draftBusy ? 'Verificando proyecto…' : 'Guardar proyecto JSON'}
            </button>
            <label className="block text-sm text-indigo-100">
              Abrir proyecto del MP3 seleccionado
              <input type="file" accept=".json,application/json"
                disabled={busy || draftBusy}
                onChange={event => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = '';
                  if (file) void openDraftFile(file);
                }}
                className="mt-2 block w-full text-xs text-slate-300 disabled:opacity-50"/>
            </label>
          </div>
        </section>
      )}
      {audio && duration > 0 && (
        <section className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-lg font-bold text-white"><AudioLines size={20} /> Intervenciones ({segments.length}/{ROLEPLAY_MAX_SCENARIOS})</h2>
            <button type="button" onClick={addSegment} disabled={segments.length >= ROLEPLAY_MAX_SCENARIOS}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><Plus size={16}/> Añadir intervención</button>
          </div>
          {segments.length === 0 && <p className="text-sm text-slate-400">Añade una intervención, define inicio y final en segundos y comprueba su título.</p>}
          {segments.map((segment, index) => (
            <article key={segment.id} className="space-y-3 rounded-xl border border-white/10 bg-slate-950/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold text-white">Intervención {index + 1}</h3>
                <button type="button" aria-label={'Quitar intervención ' + (index + 1)} onClick={() => {
                  subtitleImportRevision.current += 1;
                  setSegments(prev => prev.filter(s => s.id !== segment.id));
                }}
                  className="rounded-lg p-2 text-red-300 hover:bg-red-500/10"><Trash2 size={16}/></button>
              </div>
              <label className="block text-sm text-slate-300">Título
                <input value={segment.title} maxLength={200} onChange={event => update(segment.id, {title: event.target.value})}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-white"/>
              </label>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="text-sm text-slate-300">Inicio (segundos)
                  <input type="number" min={0} max={duration} step="0.1" value={segment.start}
                    onChange={event => update(segment.id, {start: event.target.valueAsNumber})}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-white"/>
                </label>
                <label className="text-sm text-slate-300">Final (segundos)
                  <input type="number" min={0} max={duration} step="0.1" value={segment.end}
                    onChange={event => update(segment.id, {end: event.target.valueAsNumber})}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-white"/>
                </label>
                <label className="text-sm text-slate-300">Límite de respuesta (segundos)
                  <input type="number" min={0} max={ROLEPLAY_RESPONSE_MAX_DURATION_SEC} step={1} value={segment.responseLimit}
                    onChange={event => update(segment.id, {responseLimit: event.target.valueAsNumber})}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-white"/>
                </label>
              </div>
              {captionTexts[segment.id] && (
                <div className="rounded-lg border border-amber-400/15 bg-amber-400/5 p-3">
                  <p className="text-xs font-bold text-amber-200">Transcripción de referencia · solo editor</p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-300">{captionTexts[segment.id]}</p>
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm text-slate-300">
                  Perfil del hablante
                  <select value={segment.speakerRole} onChange={event => {
                    update(segment.id, { speakerRole: event.target.value as StudioSpeakerRole });
                  }} className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-white">
                    <option value="unknown">Hablante sin identificar</option>
                    <option value="doctor">Médico / profesional de salud</option>
                    <option value="patient">Paciente</option>
                    <option value="nurse">Enfermería</option>
                    <option value="operator">Operador</option>
                    <option value="interpreter">Intérprete original — excluir</option>
                  </select>
                </label>
                <label className="block text-sm text-slate-300">
                  Idioma de la intervención
                  <select value={segment.language} onChange={event => {
                    update(segment.id, { language: event.target.value as StudioLanguage });
                  }} className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-white">
                    <option value="unknown">Por revisar</option>
                    <option value="en">Inglés (EN)</option>
                    <option value="es">Español (ES)</option>
                  </select>
                </label>
              </div>
              <button type="button" className="text-sm text-blue-300 hover:underline"
                onClick={() => update(segment.id, {
                  title: makeNeutralSegmentTitle(segment.speakerRole, segment.language, index),
                })}>
                Aplicar perfil e idioma al título
              </button>
              <label className="block text-sm text-slate-300">Instrucciones para el participante
                <textarea value={segment.scriptPrompt} maxLength={5000} rows={2}
                  onChange={event => update(segment.id, {scriptPrompt: event.target.value})}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-white"/>
              </label>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <button type="button" className="rounded-lg border border-blue-400/25 px-3 py-2 text-blue-200 hover:bg-blue-500/10"
                  onClick={() => markAtPlayhead(segment.id, 'start')}>Marcar inicio actual</button>
                <button type="button" className="rounded-lg border border-blue-400/25 px-3 py-2 text-blue-200 hover:bg-blue-500/10"
                  onClick={() => markAtPlayhead(segment.id, 'end')}>Marcar fin actual</button>
                <button type="button" className="rounded-lg border border-emerald-400/25 px-3 py-2 text-emerald-200 hover:bg-emerald-500/10"
                  onClick={() => previewSegment(segment)}>
                  {previewingId === segment.id ? 'Detener fragmento' : `Escuchar fragmento (${formatTime(segment.start)}–${formatTime(segment.end)})`}
                </button>
              </div>
            </article>
          ))}
          {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
          {notice && <p role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-100">{notice}</p>}
          <button type="button" onClick={() => void exportPackage()} disabled={busy || !segments.length}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 font-bold text-white hover:bg-emerald-500 disabled:opacity-50">
            <Download size={18} /> {busy ? 'Procesando segmentos…' : 'Exportar MP3 + manifiesto ZIP'}
          </button>
        </section>
      )}
      {error && (!audio || !duration) && <p role="alert" className="text-sm text-red-300">{error}</p>}
      <p className="text-xs leading-5 text-slate-500">Solo administración · La grabación original no se guarda en la biblioteca durante la preparación. Verifica consentimiento y ausencia de datos médicos identificables antes de publicar.</p>
    </main>
  );
}
