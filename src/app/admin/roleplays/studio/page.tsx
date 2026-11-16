'use client';

import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from 'react';
import Link from 'next/link';
import { ArrowLeft, AudioLines, Download, Plus, Trash2 } from 'lucide-react';
import { ROLEPLAY_MAX_SCENARIOS, ROLEPLAY_RESPONSE_MAX_DURATION_SEC } from '@/lib/roleplay-limits';
import {
  parseTimedTranscriptForReview, toPublishableStudioSegments,
  type TimedTranscriptCue,
} from '@/lib/roleplay-studio/transcript';
import { selectTimedCues } from '@/lib/roleplay-studio/cue-selection';
import {
  addStudioProtocol, type StudioProtocolKind, type StudioProtocolLanguage,
} from '@/lib/roleplay-studio/protocols';
import {
  suggestStudioClips, type StudioSilence, type StudioSuggestedClip,
} from '@/lib/roleplay-studio/silence-analysis';
import StudioWaveform from './StudioWaveform';
import LocalVadAssistant from './LocalVadAssistant';
import StudioConsecutivePreview from './StudioConsecutivePreview';
import {
  createStudioDraft, openStudioDraft, sha256StudioAudio, MAX_STUDIO_DRAFT_CHARS,
} from '@/lib/roleplay-studio/draft';
import {
  createLongMediaDraft, openLongMediaDraft, fingerprintLocalMedia, mediaKind,
  usesLocalLongMode, validateLocalMedia, MAX_LOCAL_MEDIA_SECONDS,
} from '@/lib/roleplay-studio/long-media';
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
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor(safe / 60) % 60;
  const seconds = safe - Math.floor(safe / 60) * 60;
  const short = String(Math.floor(safe / 60)).padStart(2, '0') + ':' +
    seconds.toFixed(1).padStart(4, '0');
  return hours
    ? String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0') + ':' +
      seconds.toFixed(1).padStart(4, '0')
    : short;
}

export default function RoleplayStudioPage() {
  const [audio, setAudio] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [duration, setDuration] = useState(0);
  const [playhead, setPlayhead] = useState(0);
  const [editorPlaybackRevision, setEditorPlaybackRevision] = useState(0);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [busy, setBusy] = useState(false);
  const [draftBusy, setDraftBusy] = useState(false);
  const [analyzingSilences, setAnalyzingSilences] = useState(false);
  const [detectedSilences, setDetectedSilences] = useState<StudioSilence[]>([]);
  const [suggestedClips, setSuggestedClips] = useState<StudioSuggestedClip[]>([]);
  const [omittedSuggestions, setOmittedSuggestions] = useState(0);
  const [protocolKind, setProtocolKind] = useState<StudioProtocolKind>('opening');
  const [protocolLanguage, setProtocolLanguage] = useState<StudioProtocolLanguage>('en');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [captionTexts, setCaptionTexts] = useState<Record<string, string>>({});
  const [excludeInterpreter, setExcludeInterpreter] = useState(true);
  const [reviewCues, setReviewCues] = useState<TimedTranscriptCue[]>([]);
  const [chosenCueIndices, setChosenCueIndices] = useState<number[]>([]);
  const [cuePage, setCuePage] = useState(0);
  const CUES_PER_PAGE = 60;
  const player = useRef<HTMLMediaElement | null>(null);
  const attachPlayer = (element: HTMLMediaElement | null) => { player.current = element; };
  const pauseEditorialAudio = useCallback(() => { player.current?.pause(); }, []);
  const previewEnd = useRef<number | null>(null);
  const subtitleImportRevision = useRef(0);
  const draftOperationRevision = useRef(0);
  const silenceRevision = useRef(0);
  const silenceAbort = useRef<AbortController | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [segmentSearch, setSegmentSearch] = useState('');
  const [compactPreference, setCompactPreference] = useState<boolean | null>(null);
  const [expandedSegmentId, setExpandedSegmentId] = useState<string | null>(null);

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
  useEffect(() => () => { silenceAbort.current?.abort(); }, []);

  const chooseAudio = (file: File | undefined) => {
    // Invalidate any in-flight SRT/VTT read bound to the previous audio.
    subtitleImportRevision.current += 1;
    draftOperationRevision.current += 1;
    silenceRevision.current += 1;
    silenceAbort.current?.abort();
    silenceAbort.current = null;
    setAnalyzingSilences(false);
    setDetectedSilences([]);
    setSuggestedClips([]);
    setOmittedSuggestions(0);
    stopPreview();
    setError('');
    setNotice('');
    setSegments([]);
    setCaptionTexts({});
    setReviewCues([]);
    setChosenCueIndices([]);
    setCuePage(0);
    setDuration(0);
    setPlayhead(0);
    setDraftBusy(false);
    if (!file) { setAudio(null); setUrl(''); return; }
    try {
      validateLocalMedia(file);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se puede abrir este archivo.');
      setAudio(null);
      setUrl('');
      return;
    }
    setAudio(file);
    setUrl(URL.createObjectURL(file));
  };

  const loadSelectedCues = (selected: TimedTranscriptCue[], excludedCount: number) => {
    const prepared: Segment[] = toPublishableStudioSegments(selected).map((segment, index) => ({
      ...segment,
      id: crypto.randomUUID(),
      speakerRole: classifySpeakerRole(selected[index].speaker),
      language: 'unknown',
    }));
    subtitleImportRevision.current += 1;
    setSegments(prepared);
    setCaptionTexts(Object.fromEntries(prepared.map((segment, index) => [segment.id, selected[index].text])));
    setNotice(`${prepared.length} intervenciones cargadas. ${excludedCount} del intérprete original omitidas; revisa idiomas, hablantes y límites antes de exportar.`);
  };

  const applyCueSelection = () => {
    setError('');
    try {
      const selected = selectTimedCues(reviewCues, chosenCueIndices);
      loadSelectedCues(selected, 0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible aplicar la selección.');
    }
  };

  const toggleCueSelection = (index: number) => {
    subtitleImportRevision.current += 1;
    if (chosenCueIndices.includes(index)) {
      setChosenCueIndices(prev => prev.filter(value => value !== index));
      return;
    }
    if (chosenCueIndices.length >= ROLEPLAY_MAX_SCENARIOS) {
      setError(`Puedes seleccionar como máximo ${ROLEPLAY_MAX_SCENARIOS} intervenciones.`);
      return;
    }
    setError('');
    setChosenCueIndices(prev => [...prev, index].sort((a, b) => a - b));
  };

  const analyzeSilences = async () => {
    if (!audio || !duration || busy || draftBusy || analyzingSilences) return;
    const revision = ++silenceRevision.current;
    const controller = new AbortController();
    silenceAbort.current?.abort();
    silenceAbort.current = controller;
    setAnalyzingSilences(true);
    setError('');
    setNotice('');
    setDetectedSilences([]);
    setSuggestedClips([]);
    setOmittedSuggestions(0);

    try {
      const form = new FormData();
      form.append('audio', audio);
      const response = await fetch('/api/admin/roleplays/studio/silences', {
        method: 'POST', credentials: 'same-origin', body: form, signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(typeof body?.error === 'string'
          ? body.error : 'No fue posible detectar las pausas del MP3.');
      }
      const body: unknown = await response.json();
      if (!body || typeof body !== 'object' || !('durationSeconds' in body) ||
          !('silences' in body) || typeof body.durationSeconds !== 'number' ||
          !Array.isArray(body.silences)) {
        throw new Error('El servidor devolvió un resultado de análisis incompleto.');
      }
      const decodedDuration = body.durationSeconds;
      if (!Number.isFinite(decodedDuration) || decodedDuration <= 0 ||
          Math.abs(decodedDuration - duration) > Math.max(1, duration * 0.03) ||
          body.silences.length > 500) {
        throw new Error('La duración del MP3 no coincide o el análisis es demasiado extenso.');
      }
      const pauses: StudioSilence[] = body.silences.map((item: unknown) => {
        if (!item || typeof item !== 'object' || !('start' in item) ||
            !('end' in item) || typeof item.start !== 'number' ||
            typeof item.end !== 'number') {
          throw new Error('El servidor devolvió pausas con tiempos inválidos.');
        }
        return { start: item.start, end: item.end };
      });
      const proposal = suggestStudioClips(pauses, decodedDuration);
      if (revision !== silenceRevision.current || controller.signal.aborted) return;
      setDetectedSilences(pauses);
      setSuggestedClips(proposal.clips);
      setOmittedSuggestions(proposal.omittedCount);
      setNotice(`Análisis local del servidor completado: ${pauses.length} pausas y ${proposal.clips.length} cortes sugeridos. Escucha y revisa cada intervención antes de publicarla.`);
    } catch (cause) {
      if (revision === silenceRevision.current && !controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'No fue posible analizar el MP3.');
      }
    } finally {
      if (revision === silenceRevision.current) {
        setAnalyzingSilences(false);
        silenceAbort.current = null;
      }
    }
  };

  const applySilenceSuggestions = () => {
    if (!suggestedClips.length || analyzingSilences || busy || draftBusy) return;
    subtitleImportRevision.current += 1;
    setSegments(suggestedClips.map((clip, index) => ({
      id: crypto.randomUUID(),
      title: `Intervención sugerida ${index + 1}`,
      start: clip.start, end: clip.end, scriptPrompt: '',
      responseLimit: 120, speakerRole: 'unknown', language: 'unknown',
    })));
    setCaptionTexts({});
    setReviewCues([]);
    setChosenCueIndices([]);
    setError('');
    setNotice('Cortes sugeridos aplicados. Son aproximaciones basadas en pausas, no separación de voces. Revisa cada inicio, fin, rol e idioma antes de exportar.');
  };

  const importSubtitles = async (file: File) => {
    if (!audio || !duration) return;
    const revision = ++subtitleImportRevision.current;
    setError('');
    setNotice('');
    try {
      const subtitleMaxBytes = usesLocalLongMode(audio, duration) ? 5_000_000 : 1_000_000;
      if (!/\.(srt|vtt)$/i.test(file.name) || file.size < 1 || file.size > subtitleMaxBytes) {
        throw new Error('Selecciona un SRT o VTT dentro del tamaño permitido (1 MB normal, 5 MB local).');
      }
      const transcript = await file.text();
      // The file may have changed, or a newer import/edit may have started.
      if (revision !== subtitleImportRevision.current) return;
      const cues = parseTimedTranscriptForReview(transcript, usesLocalLongMode(audio, duration));
      const { selected, excludedCount } = filterInterpreterCues(cues, excludeInterpreter);
      if (!selected.length) {
        throw new Error('No quedan intervenciones del médico o paciente después de excluir las del intérprete.');
      }
      if (selected.some(cue => cue.end > duration + 0.1)) {
        throw new Error('Los subtítulos contienen intervalos posteriores al final de la grabación.');
      }
      // The long source transcript is only browser-side reference material.
      // A 500-cue recording cannot be published as an unreviewed 500-scene task.
      const allIndices = selected.map((_, index) => index);
      let canApplyAll = selected.length <= ROLEPLAY_MAX_SCENARIOS;
      if (canApplyAll) {
        try { selectTimedCues(selected, allIndices); }
        catch { canApplyAll = false; }
      }
      if (canApplyAll) {
        setReviewCues([]);
        setChosenCueIndices([]);
        setCuePage(0);
        loadSelectedCues(selected, excludedCount);
      } else {
        setCuePage(0);
        setReviewCues(selected);
        setChosenCueIndices(allIndices.slice(0, ROLEPLAY_MAX_SCENARIOS));
        setNotice(`${selected.length} intervenciones disponibles; ${excludedCount} del intérprete original omitidas. Elige hasta ${ROLEPLAY_MAX_SCENARIOS} turnos compatibles y pulsa “Aplicar selección”. El borrador no se reemplazó.`);
      }
    } catch (cause) {
      if (revision !== subtitleImportRevision.current) return;
      setError(cause instanceof Error ? cause.message : 'No fue posible leer el archivo de subtítulos.');
    }
  };

  const splitAtPlayhead = (id: string) => {
    const segment = segments.find(item => item.id === id);
    const cursor = player.current?.currentTime;
    if (!segment || cursor === undefined || !Number.isFinite(cursor)) return;
    const midpoint = Number(cursor.toFixed(2));
    if (segments.length >= ROLEPLAY_MAX_SCENARIOS) {
      setError('Se alcanzó el máximo de intervenciones exportables.');
      return;
    }
    if (midpoint - segment.start < 0.1 || segment.end - midpoint < 0.1) {
      setError('Sitúa el cursor dentro de la intervención, dejando al menos 0,1 s por lado.');
      return;
    }
    subtitleImportRevision.current += 1;
    const secondId = crypto.randomUUID();
    setSegments(previous => previous.flatMap(item => item.id === id ? [
      { ...item, end: midpoint },
      { ...item, id: secondId, start: midpoint,
        title: item.title.slice(0, 185) + ' (parte 2)' },
    ] : [item]));
    // Preserve the original transcript as editor-only reference for both
    // halves. We cannot infer a word-level split from a timestamp alone.
    setCaptionTexts(previous => previous[id]
      ? { ...previous, [secondId]: previous[id] } : previous);
    setExpandedSegmentId(secondId);
    setError('');
    setNotice('Corte dividido. La transcripción original se conserva en ambas partes como referencia; revisa dónde se separa el diálogo.');
  };

  const mergeWithNext = (id: string) => {
    const ordered = [...segments].sort((a, b) => a.start - b.start);
    const current = ordered.findIndex(item => item.id === id);
    const first = ordered[current];
    const second = ordered[current + 1];
    if (!first || !second) { setError('No hay una intervención posterior.'); return; }
    if (first.speakerRole !== second.speakerRole || first.language !== second.language) {
      setError('La unión exige el mismo perfil del hablante e idioma.'); return;
    }
    if (second.start < first.end || second.start - first.end > 2 ||
        second.end - first.start > 300) {
      setError('La unión no permite solapamientos, pausas mayores de 2 s ni cortes de más de 5 minutos.');
      return;
    }
    const prompts = [first.scriptPrompt, second.scriptPrompt].filter(Boolean);
    const mergedPrompt = [...new Set(prompts)].join('\n\n');
    if (mergedPrompt.length > 5000) {
      setError('Las instrucciones combinadas exceden 5.000 caracteres.'); return;
    }
    subtitleImportRevision.current += 1;
    setSegments(previous => previous.filter(item => item.id !== second.id)
      .map(item => item.id === first.id
        ? { ...item, end: second.end, scriptPrompt: mergedPrompt } : item));
    setCaptionTexts(previous => {
      const next = { ...previous };
      // A previously split cue retains the same reference in both halves;
      // rejoining it must not duplicate private transcript text.
      const references = [previous[first.id], previous[second.id]].filter(Boolean);
      next[first.id] = [...new Set(references)].join(' ');
      delete next[second.id];
      return next;
    });
    setError('');
    setNotice('Intervenciones unidas. Verifica audio, tiempos y texto antes de exportar.');
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
      const localOnly = usesLocalLongMode(audio, duration);
      const digest = localOnly ? await fingerprintLocalMedia(audio) : await sha256StudioAudio(audio);
      if (revision !== subtitleImportRevision.current) return;
      const draft = localOnly
        ? createLongMediaDraft(audio.size, digest, snapshot, duration)
        : createStudioDraft(audio.size, digest, snapshot, duration);
      const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' });
      if (blob.size > MAX_STUDIO_DRAFT_CHARS) {
        throw new Error('El proyecto supera 180 KB. Reduce las instrucciones antes de guardarlo.');
      }
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = usesLocalLongMode(audio, duration)
        ? 'roleplay-studio-proyecto-largo.json' : 'roleplay-studio-proyecto.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 30000);
      setNotice(usesLocalLongMode(audio, duration)
        ? 'Plan de cortes local descargado. Conserva la grabación original; el JSON no contiene audio ni video ni transcripción. La huella es parcial y no verifica cada byte.'
        : 'Proyecto guardado localmente. Conserva también el MP3 original; el JSON no contiene audio ni transcripción.');
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
      const localOnly = usesLocalLongMode(audio, duration);
      const digest = localOnly ? await fingerprintLocalMedia(audio) : await sha256StudioAudio(audio);
      if (revision !== subtitleImportRevision.current) return;
      const restored = localOnly
        ? openLongMediaDraft(json, audio.size, digest, duration)
        : openStudioDraft(json, audio.size, digest, duration);
      setSegments(restored.map(segment => ({ ...segment, id: crypto.randomUUID() })));
      setCaptionTexts({});
      setReviewCues([]);
      setChosenCueIndices([]);
      setNotice(localOnly
        ? `Proyecto vinculado por tamaño, duración y huella parcial, restaurado: ${restored.length} intervenciones. El archivo original no se ha subido.`
        : `Proyecto verificado con SHA-256 y restaurado: ${restored.length} intervenciones. La transcripción no forma parte del borrador.`);
    } catch (cause) {
      if (revision === subtitleImportRevision.current) {
        setError(cause instanceof Error ? cause.message : 'No se pudo abrir el proyecto.');
      }
    } finally {
      if (operation === draftOperationRevision.current) setDraftBusy(false);
    }
  };

  const insertProtocol = (segment: Segment) => {
    setError('');
    try {
      const result = addStudioProtocol(segment.scriptPrompt, protocolKind, protocolLanguage);
      if (!result.added) {
        setNotice('Este protocolo ya aparece en las instrucciones de la intervención.');
        return;
      }
      update(segment.id, { scriptPrompt: result.text });
      setNotice('Protocolo añadido a las instrucciones. Revísalo antes de asignar el ejercicio a candidatos o intérpretes.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo añadir el protocolo.');
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
    // Large files stay local: the legacy export endpoint reads its entire
    // MP3 request into memory and must never receive a video or large source.
    if (usesLocalLongMode(audio, duration)) {
      await saveDraft();
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

  const localOnly = audio !== null && usesLocalLongMode(audio, duration);
  const videoSource = audio !== null && mediaKind(audio) === 'video';
  const pageCount = Math.max(1, Math.ceil(reviewCues.length / CUES_PER_PAGE));
  const visibleCues = reviewCues.slice(cuePage * CUES_PER_PAGE, (cuePage + 1) * CUES_PER_PAGE);

  // Only the selected row expands when reviewing a longer recording.
  const compactRows = compactPreference ?? (localOnly || segments.length >= 6);
  const query = segmentSearch.trim().toLocaleLowerCase();
  const visibleSegments = segments.map((segment, index) => ({ segment, index }))
    .filter(({ segment }) => !query ||
      [segment.title, segment.scriptPrompt, captionTexts[segment.id] || '',
        segment.speakerRole, segment.language]
        .some(value => value.toLocaleLowerCase().includes(query)))
    .sort((a, b) => a.segment.start - b.segment.start);

  const mediaHandlers = {
    onPlay: () => setEditorPlaybackRevision(n => n + 1),
    onLoadedMetadata: (event: SyntheticEvent<HTMLMediaElement>) => {
      const length = event.currentTarget.duration;
      if (!Number.isFinite(length) || length <= 0) {
        setDuration(0);
        setError('No se pudo determinar la duración de la grabación. Verifica el formato.');
      } else if (length > MAX_LOCAL_MEDIA_SECONDS) {
        setDuration(0);
        setError('El archivo supera las 12 horas admitidas en modo local.');
      } else {
        setDuration(length);
        setError('');
      }
    },
    onTimeUpdate: (event: SyntheticEvent<HTMLMediaElement>) => {
      setPlayhead(event.currentTarget.currentTime);
      if (previewEnd.current !== null &&
          event.currentTarget.currentTime >= previewEnd.current) stopPreview();
    },
    onPause: () => { previewEnd.current = null; setPreviewingId(null); },
    onEnded: () => { previewEnd.current = null; setPreviewingId(null); },
    onError: () => {
      setDuration(0);
      setError('El navegador no puede decodificar esta grabación. Prueba MP4/H.264 con AAC o MP3.');
    },
  };

  return (
    <main className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/admin/roleplays" className="mb-3 inline-flex items-center gap-2 text-sm text-blue-300"><ArrowLeft size={16} /> Volver a roleplays</Link>
          <h1 className="text-3xl font-bold text-white">Roleplay Audio Studio</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            Prepara intervenciones desde una grabación de audio o video sin crear sesiones
            ni modificar audios publicados. Los MP3 pequeños permiten exportar el ZIP;
            fuentes extensas se revisan localmente y se guardan como un proyecto de cortes.
          </p>
        </div>
        <Link href="/admin/roleplays/new" className="rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-500">Importar y asignar</Link>
      </header>
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <label htmlFor="studio-audio" className="block text-sm font-semibold text-white">
          Grabación original MP3 o video/audio largo (local, hasta 8 GiB)
        </label>
        <input id="studio-audio" type="file"
          accept=".mp3,.m4a,.wav,.aac,.ogg,.oga,.opus,.flac,.mp4,.m4v,.mov,.webm,.mkv,audio/*,video/*"
          className="mt-2 block w-full text-sm text-slate-300"
          onChange={event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            chooseAudio(file);
          }} />
        {url && (
          <div className="mt-5 space-y-3">
            {videoSource
              ? <video ref={attachPlayer} src={url} controls preload="metadata" playsInline
                  {...mediaHandlers} className="max-h-64 w-full rounded-lg bg-black"/>
              : <audio ref={attachPlayer} src={url} controls preload="metadata"
                  {...mediaHandlers} className="w-full"/>}
            {localOnly && duration > 0 && (
              <div className="rounded-lg border border-cyan-400/20 bg-cyan-400/5 px-3 py-2 text-xs leading-5 text-cyan-100">
                <strong>Preparación local:</strong> la grabación no se sube al servidor.
                Puedes revisar, marcar y guardar los cortes sin decodificar el archivo completo.
                El JSON no contiene audio ni video. El ZIP requiere extraer los clips con
                FFmpeg localmente; el navegador no convierte esta fuente extensa.
                <details className="mt-2 rounded border border-cyan-300/15 px-2 py-1">
                  <summary className="cursor-pointer font-semibold">Cómo generar el ZIP sin subir el original</summary>
                  <p className="mt-2">
                    En un equipo con Node.js y el repositorio instalado, ejecuta el exportador
                    indicando las rutas del video, el JSON y el ZIP de salida.
                  </p>
                  <code className="mt-1 block break-all rounded bg-slate-950/70 p-2 text-[11px] text-slate-200">
                    node scripts/export-studio-long-local.mjs --source llamada.mp4 --project roleplay-studio-proyecto-largo.json --output roleplay-studio.zip
                  </code>
                </details>
              </div>
            )}
            {audio && duration > 0 && (
              <StudioWaveform
                file={audio}
                duration={duration}
                currentTime={playhead}
                segments={segments}
                onSeek={seekAudio}
              />
            )}
            <p className="text-xs text-slate-400">
              Duración: {formatTime(duration)} · Navega por la línea de tiempo
              y marca los límites en el cursor. El zoom no decodifica el archivo completo.
            </p>
            {audio && !localOnly && (
              <LocalVadAssistant
                key={url}
                file={audio}
                duration={duration}
              remaining={Math.max(0, ROLEPLAY_MAX_SCENARIOS - segments.length)}
              onApply={(detected) => {
                subtitleImportRevision.current += 1;
                setSegments(prev => {
                  const additions = detected.slice(0, Math.max(0, ROLEPLAY_MAX_SCENARIOS - prev.length));
                  return [...prev, ...additions.map((item, index) => ({
                    id: crypto.randomUUID(),
                    title: 'Intervención ' + (prev.length + index + 1),
                    start: item.start,
                    end: item.end,
                    scriptPrompt: '',
                    responseLimit: 120,
                    speakerRole: 'unknown' as const,
                    language: 'unknown' as const,
                  }))];
                });
                setNotice('Cortes VAD añadidos. Verifica hablantes, idioma y límites antes de exportar.');
              }}
              />
            )}
            {!localOnly && <div className="rounded-xl border border-violet-400/20 bg-violet-400/5 p-4">
              <h2 className="text-sm font-bold text-violet-100">Asistente gratuito de pausas</h2>
              <p className="mt-2 text-xs leading-5 text-slate-300">
                FFmpeg puede localizar silencios del MP3 para sugerir posibles cortes.
                No transcribe, distingue inglés y español ni identifica médico, paciente o intérprete.
                La grabación se procesa temporalmente en nuestro servidor y no se guarda en la biblioteca.
              </p>
              <button type="button" onClick={() => void analyzeSilences()}
                disabled={analyzingSilences || busy || draftBusy}
                className="mt-3 rounded-lg border border-violet-300/30 bg-violet-500/20 px-4 py-2 text-sm font-semibold text-violet-100 disabled:opacity-50">
                {analyzingSilences ? 'Analizando pausas…' : 'Detectar pausas del MP3'}
              </button>
              {detectedSilences.length > 0 && (
                <div className="mt-3 space-y-2">
                  <p className="text-sm text-slate-200">
                    {detectedSilences.length} pausas detectadas · {suggestedClips.length} cortes sugeridos
                    {omittedSuggestions > 0 ? ` · ${omittedSuggestions} intervalos omitidos por los límites` : ''}
                  </p>
                  <div className="flex max-h-36 flex-wrap gap-2 overflow-y-auto">
                    {detectedSilences.slice(0, 40).map((pause, index) => (
                      <button key={index} type="button"
                        onClick={() => seekAudio((pause.start + pause.end) / 2)}
                        className="rounded-md border border-white/10 bg-slate-950/70 px-2 py-1 text-xs text-blue-200">
                        Pausa {index + 1}: {formatTime(pause.start)}–{formatTime(pause.end)}
                      </button>
                    ))}
                  </div>
                  {detectedSilences.length > 40 && (
                    <p className="text-xs text-slate-400">Se muestran las primeras 40 pausas. Navega el resto con la línea de tiempo.</p>
                  )}
                </div>
              )}
              {suggestedClips.length > 0 && (
                <div className="mt-3 space-y-2">
                  <p className="text-xs leading-5 text-amber-100">
                    Las sugerencias pueden dividir frases o incluir la voz del intérprete original.
                    Aplicarlas reemplazará los segmentos actuales; los títulos e idiomas quedarán por revisar.
                  </p>
                  <button type="button" onClick={applySilenceSuggestions}
                    disabled={analyzingSilences || busy || draftBusy}
                    className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
                    Reemplazar con {suggestedClips.length} cortes sugeridos
                  </button>
                </div>
              )}
            </div>}
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
      {audio && duration > 0 && reviewCues.length > 0 && (
        <section className="space-y-4 rounded-2xl border border-amber-400/25 bg-amber-400/5 p-5">
          <h2 className="text-lg font-bold text-white">Seleccionar turnos de la transcripción</h2>
          <p className="text-sm text-slate-300">
            Hay {reviewCues.length} turnos disponibles y {chosenCueIndices.length} seleccionados
            (máximo {ROLEPLAY_MAX_SCENARIOS}). Solo los turnos marcados se convertirán en
            escenarios. Revisa cualquier solapamiento o diálogo del intérprete antes de aplicar.
            Esta acción reemplaza las intervenciones actuales del editor.
          </p>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300">
            <span>Mostrando {cuePage * CUES_PER_PAGE + 1}–
              {Math.min((cuePage + 1) * CUES_PER_PAGE, reviewCues.length)} de {reviewCues.length} turnos</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setCuePage(page => Math.max(0, page - 1))}
                disabled={cuePage === 0} className="rounded border border-white/15 px-2 py-1 disabled:opacity-30">
                Anterior
              </button>
              <label className="flex items-center gap-1">
                Página
                <input type="number" aria-label="Página de intervenciones SRT"
                  min={1} max={pageCount} value={cuePage + 1}
                  onChange={event => {
                    const requested = Number(event.currentTarget.value);
                    if (Number.isSafeInteger(requested) && requested >= 1 && requested <= pageCount) {
                      setCuePage(requested - 1);
                    }
                  }}
                  className="w-14 rounded border border-white/15 bg-slate-900 px-1 py-1 text-center text-xs text-white"/>
                / {pageCount}
              </label>
              <button type="button" onClick={() => setCuePage(page => Math.min(pageCount - 1, page + 1))}
                disabled={cuePage >= pageCount - 1}
                className="rounded border border-white/15 px-2 py-1 disabled:opacity-30">
                Siguiente
              </button>
            </div>
          </div>
          <div className="max-h-80 space-y-2 overflow-y-auto rounded-xl border border-white/10 bg-slate-950/70 p-3">
            {visibleCues.map((cue, offset) => {
              const index = cuePage * CUES_PER_PAGE + offset;
              return (
              <div key={index} className="flex items-start gap-3 rounded-lg border border-white/5 p-2">
                <input type="checkbox" checked={chosenCueIndices.includes(index)}
                  aria-label={`Seleccionar turno ${index + 1}`}
                  onChange={() => toggleCueSelection(index)}
                  className="mt-1 h-4 w-4 shrink-0 accent-blue-500"/>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-amber-200">
                    {index + 1} · {formatTime(cue.start)}–{formatTime(cue.end)} ·
                    {classifySpeakerRole(cue.speaker) === 'unknown'
                      ? ' Hablante por revisar'
                      : ` ${cue.speaker}`}
                  </p>
                  <p className="mt-1 break-words text-xs text-slate-300">
                    {cue.text.slice(0, 200)}{cue.text.length > 200 ? '…' : ''}
                  </p>
                </div>
                <button type="button" onClick={() => seekAudio(cue.start)}
                  aria-label={`Escuchar desde turno ${index + 1}`}
                  className="shrink-0 text-xs text-blue-300 hover:underline">
                  Escuchar
                </button>
              </div>
            ); })}
          </div>
          <button type="button" onClick={applyCueSelection}
            className="rounded-xl bg-amber-500/20 px-4 py-2 text-sm font-bold text-amber-100 hover:bg-amber-500/30">
            Aplicar selección al editor ({chosenCueIndices.length})
          </button>
        </section>
      )}
      {audio && duration > 0 && (
        <section className="space-y-3 rounded-2xl border border-indigo-400/20 bg-indigo-400/5 p-5">
          <h2 className="text-lg font-bold text-white">Proyecto de edición</h2>
          <p className="text-sm leading-6 text-slate-300">
            {localOnly
              ? 'Guarda los tiempos y perfiles sin subir el archivo. El proyecto se vincula a la fuente mediante tamaño, duración y SHA-256 de muestras: no es una verificación de todos sus bytes.'
              : 'Guarda los cortes y perfiles. El proyecto se verifica contra el MP3 original mediante SHA-256 completo.'}
            El JSON no contiene audio, video ni transcripción, pero sí títulos e instrucciones:
            protégelo si contienen información sensible.
          </p>
          <div className="flex flex-wrap items-end gap-4">
            <button type="button" onClick={() => void saveDraft()}
              disabled={busy || draftBusy}
              className="rounded-xl border border-indigo-300/30 bg-indigo-500/20 px-4 py-2 text-sm font-semibold text-indigo-100 disabled:opacity-50">
              {draftBusy ? 'Verificando proyecto…' : 'Guardar proyecto JSON'}
            </button>
            <label className="block text-sm text-indigo-100">
              {localOnly ? 'Abrir proyecto del archivo local seleccionado' : 'Abrir proyecto del MP3 seleccionado'}
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
        <section className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-lg font-bold text-white"><AudioLines size={20} /> Intervenciones ({segments.length}/{ROLEPLAY_MAX_SCENARIOS})</h2>
            <div className="flex flex-wrap items-center gap-2">
              <input type="search" aria-label="Buscar intervenciones" value={segmentSearch}
                onChange={event => setSegmentSearch(event.currentTarget.value)}
                placeholder="Buscar turno, hablante o nota…"
                className="w-48 rounded-lg border border-white/15 bg-slate-900 px-2 py-1.5 text-xs text-white placeholder:text-slate-500"/>
              <button type="button" onClick={() => setCompactPreference(!compactRows)}
                aria-pressed={compactRows}
                className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-slate-200">
                {compactRows ? 'Vista detallada' : 'Vista compacta'}
              </button>
              <button type="button" onClick={addSegment} disabled={segments.length >= ROLEPLAY_MAX_SCENARIOS}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"><Plus size={16}/> Añadir intervención</button>
            </div>
          </div>
          <details open={!localOnly} className="space-y-3 rounded-lg border border-teal-400/20 bg-teal-400/5 p-3">
            <summary className="cursor-pointer text-sm font-semibold text-teal-100">
              Protocolos de interpretación consecutiva (opcional)
            </summary>
            <p className="text-xs leading-5 text-slate-300">
              Plantillas opcionales de apertura, petición de repetición y cierre.
              Solo se insertan en las instrucciones de la intervención que elijas;
              no crean audios ni respuestas modelo. El participante podrá leerlas al abrir «Ver guión».
              Evita incluirlas en evaluaciones sin ayuda si revelarían la respuesta.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-slate-200">Protocolo
                <select value={protocolKind}
                  onChange={event => setProtocolKind(event.currentTarget.value as StudioProtocolKind)}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-white">
                  <option value="opening">Apertura</option>
                  <option value="repetition">Pedir repetición / aclaración</option>
                  <option value="closing">Cierre</option>
                </select>
              </label>
              <label className="text-sm text-slate-200">Idioma del protocolo
                <select value={protocolLanguage}
                  onChange={event => setProtocolLanguage(event.currentTarget.value as StudioProtocolLanguage)}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-white">
                  <option value="en">Inglés</option>
                  <option value="es">Español</option>
                </select>
              </label>
            </div>
          </details>
          {segments.length === 0 && <p className="text-sm text-slate-400">Añade una intervención, define inicio y final en segundos y comprueba su título.</p>}
          {segments.length > 0 && visibleSegments.length === 0 && (
            <p className="text-sm text-slate-400">No hay intervenciones que coincidan con la búsqueda.</p>
          )}
          {segments.length >= 6 && (
            <p className="text-xs text-slate-400">
              {visibleSegments.length} de {segments.length} turnos. Abre «Editar» para
              modificar una intervención o utiliza «Vista detallada».
            </p>
          )}
          {visibleSegments.map(({ segment, index }) => (
            <article key={segment.id} className="space-y-2 rounded-lg border border-white/10 bg-slate-950/70 p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-white">
                  #{index + 1} · {segment.title}
                  <span className="ml-2 text-xs font-normal text-slate-400">
                    {formatTime(segment.start)}–{formatTime(segment.end)} · {segment.speakerRole} · {segment.language.toUpperCase()}
                  </span>
                  {captionTexts[segment.id] && compactRows && (
                    <span className="ml-2 inline-block max-w-64 truncate align-bottom text-xs font-normal text-amber-200/80">
                      {captionTexts[segment.id]}
                    </span>
                  )}
                </h3>
                <button type="button" onClick={() => splitAtPlayhead(segment.id)}
                  aria-label={'Dividir intervención ' + (index + 1) + ' en cursor'}
                  className="rounded-md border border-white/15 px-2 py-1 text-xs text-slate-300">
                  Dividir
                </button>
                <button type="button" onClick={() => mergeWithNext(segment.id)}
                  aria-label={'Unir intervención ' + (index + 1) + ' con siguiente'}
                  className="rounded-md border border-white/15 px-2 py-1 text-xs text-slate-300">
                  Unir
                </button>
                {compactRows && (
                  <>
                    <button type="button" onClick={() => previewSegment(segment)}
                      className="rounded-md border border-emerald-400/25 px-2 py-1 text-xs text-emerald-200">
                      {previewingId === segment.id ? 'Detener fragmento' : 'Escuchar fragmento'}
                    </button>
                    <button type="button" onClick={() =>
                      setExpandedSegmentId(prev => prev === segment.id ? null : segment.id)}
                      aria-expanded={expandedSegmentId === segment.id}
                      className="rounded-md border border-blue-400/25 px-2 py-1 text-xs text-blue-200">
                      {expandedSegmentId === segment.id ? 'Contraer' : 'Editar'}
                    </button>
                  </>
                )}
                <button type="button" aria-label={'Quitar intervención ' + (index + 1)} onClick={() => {
                  subtitleImportRevision.current += 1;
                  setSegments(prev => prev.filter(s => s.id !== segment.id));
                }}
                  className="rounded-lg p-2 text-red-300 hover:bg-red-500/10"><Trash2 size={16}/></button>
              </div>
              {(!compactRows || expandedSegmentId === segment.id) && (
              <div className="space-y-2 border-t border-white/5 pt-2">
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
              <button type="button" onClick={() => insertProtocol(segment)}
                className="rounded-lg border border-teal-400/30 bg-teal-400/5 px-3 py-2 text-sm text-teal-100 hover:bg-teal-400/10">
                Añadir protocolo seleccionado a esta intervención
              </button>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <button type="button" className="rounded-lg border border-blue-400/25 px-3 py-2 text-blue-200 hover:bg-blue-500/10"
                  onClick={() => markAtPlayhead(segment.id, 'start')}>Marcar inicio actual</button>
                <button type="button" className="rounded-lg border border-blue-400/25 px-3 py-2 text-blue-200 hover:bg-blue-500/10"
                  onClick={() => markAtPlayhead(segment.id, 'end')}>Marcar fin actual</button>
                {!compactRows && (
                  <button type="button" className="rounded-lg border border-emerald-400/25 px-3 py-2 text-emerald-200 hover:bg-emerald-500/10"
                    onClick={() => previewSegment(segment)}>
                    {previewingId === segment.id ? 'Detener fragmento' : `Escuchar fragmento (${formatTime(segment.start)}–${formatTime(segment.end)})`}
                  </button>
                )}
              </div>
              </div>
              )}
            </article>
          ))}
          {segments.length > 0 && !localOnly && (
            <StudioConsecutivePreview
              sourceUrl={url}
              sourceDuration={duration}
              segments={segments}
              interruptRevision={editorPlaybackRevision}
              onStart={pauseEditorialAudio}
            />
          )}
          {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
          {notice && <p role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-100">{notice}</p>}
          <button type="button" onClick={() => void exportPackage()} disabled={busy || analyzingSilences || !segments.length}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 font-bold text-white hover:bg-emerald-500 disabled:opacity-50">
            <Download size={18} /> {busy
              ? 'Procesando segmentos…'
              : localOnly ? 'Descargar plan local de cortes (JSON)' : 'Exportar MP3 + manifiesto ZIP'}
          </button>
        </section>
      )}
      {error && (!audio || !duration) && <p role="alert" className="text-sm text-red-300">{error}</p>}
      <p className="text-xs leading-5 text-slate-500">
        Solo administración · Los archivos originales locales no se guardan en la biblioteca.
        Verifica consentimiento y ausencia de datos médicos identificables antes de publicar.
      </p>
    </main>
  );
}
