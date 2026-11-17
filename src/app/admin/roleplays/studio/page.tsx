'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react';
import Link from 'next/link';
import { ArrowLeft, AudioLines, Download, Plus, Trash2 } from 'lucide-react';
import { ROLEPLAY_MAX_SCENARIOS, ROLEPLAY_RESPONSE_MAX_DURATION_SEC } from '@/lib/roleplay-limits';
import {
  parseTimedTranscriptForReview, toPublishableStudioSegments,
  type TimedTranscriptCue,
} from '@/lib/roleplay-studio/transcript';
import { selectTimedCues } from '@/lib/roleplay-studio/cue-selection';
import { availableStudioInterval } from '@/lib/roleplay-studio/available-interval';
import { summarizeStudioCoverage } from '@/lib/roleplay-studio/coverage';
import { planGaplessPair, type GaplessPairPlan } from '@/lib/roleplay-studio/gapless-pair-preview';
import { validStudioRanges, studioSelectedSeconds, type StudioCutRange } from '@/lib/roleplay-studio/compound-cuts';
import { formatStudioTime as formatTime } from '@/lib/roleplay-studio/format-time';
import {
  addStudioProtocol, type StudioProtocolKind, type StudioProtocolLanguage,
} from '@/lib/roleplay-studio/protocols';
import {
  suggestStudioClips, type StudioSilence, type StudioSuggestedClip,
} from '@/lib/roleplay-studio/silence-analysis';
import StudioWaveform from './StudioWaveform';
import type { LocalVadSnapshot } from '@/lib/roleplay-studio/local-vad';
import LocalVadAssistant from './LocalVadAssistant';
import StudioConsecutivePreview from './StudioConsecutivePreview';
import { detectStudioProjectFormat } from '@/lib/roleplay-studio/project-format';
import {
  createStudioDraft, openStudioDraft, sha256StudioAudio, MAX_STUDIO_DRAFT_CHARS,
} from '@/lib/roleplay-studio/draft';
import {
  createLongMediaDraft, openLongMediaDraft, fingerprintLocalMedia, mediaKind,
  usesLocalLongMode, validateLocalMedia, MAX_LOCAL_MEDIA_SECONDS,
} from '@/lib/roleplay-studio/long-media';
import {
  classifySpeakerRole, filterInterpreterCues, makeNeutralSegmentTitle,
  titleAfterProfileChange, type StudioLanguage, type StudioSpeakerRole,
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
  ranges?: StudioCutRange[];
};



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
  const [serverConsent, setServerConsent] = useState(false);
  const [allowServerZipExport, setAllowServerZipExport] = useState(false);
  const [localVadSnapshot, setLocalVadSnapshot] = useState<LocalVadSnapshot | null>(null);
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
  const [cueSearch, setCueSearch] = useState('');
  const [showOnlySelectedCues, setShowOnlySelectedCues] = useState(false);
  const CUES_PER_PAGE = 60;
  const player = useRef<HTMLMediaElement | null>(null);
  const pairPlayer = useRef<HTMLAudioElement | null>(null);
  const pairPlayback = useRef<{ plan: GaplessPairPlan; stage: 1 | 2 } | null>(null);
  const [pairPreviewId, setPairPreviewId] = useState<string | null>(null);
  const [lastStructuralEdit, setLastStructuralEdit] = useState<{
    kind: 'división' | 'unión' | 'separación' | 'exclusión';
    segments: Segment[];
    captions: Record<string, string>;
    expandedId: string | null;
  } | null>(null);
  // Source identity prevents a delayed decode from updating a replacement MP3.
  const activeAudioFile = useRef<File | null>(null);
  const attachPlayer = (element: HTMLMediaElement | null) => { player.current = element; };
  const pauseEditorialAudio = useCallback(() => { player.current?.pause(); pairPlayer.current?.pause(); }, []);
  const previewEnd = useRef<number | null>(null);
  const subtitleImportRevision = useRef(0);
  const draftOperationRevision = useRef(0);
  const silenceRevision = useRef(0);
  const silenceAbort = useRef<AbortController | null>(null);
  const exportRevision = useRef(0);
  const exportAbort = useRef<AbortController | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [segmentSearch, setSegmentSearch] = useState('');
  const [showPendingReview, setShowPendingReview] = useState(false);
  const [compactPreference, setCompactPreference] = useState<boolean | null>(null);
  const [expandedSegmentId, setExpandedSegmentId] = useState<string | null>(null);
  const [turnActionFeedback, setTurnActionFeedback] = useState<{
    id: string; message: string; error: boolean;
  } | null>(null);

  const reportTurnAction = (id: string, message: string, error = false) => {
    // The global notification sits after all rows and is easy to miss in
    // long projects. Keep operation feedback beside the clicked turn.
    setError('');
    setNotice('');
    setTurnActionFeedback({ id, message, error });
  };

  const stopPairPreview = () => {
    const wasActive = pairPlayback.current !== null;
    pairPlayback.current = null;
    setPairPreviewId(null);
    // Never pause an idle auxiliary player: changing ordinary clips must not
    // interfere with the primary player's pause/resume lifecycle.
    if (wasActive) pairPlayer.current?.pause();
  };

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
    stopPairPreview();
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
    if (segment.ranges) { previewPairWithoutGap(segment.id); return; }
    const audioPlayer = player.current;
    if (!audioPlayer || !Number.isFinite(segment.start) || !Number.isFinite(segment.end) ||
      segment.end <= segment.start || segment.start < 0 || segment.end > duration) return;
    if (previewingId === segment.id) {
      stopPreview();
      return;
    }
    // Seek directly even if audio is already playing. Calling pause() here
    // schedules an onPause event which can clear the new segment's end marker.
    stopPairPreview();
    audioPlayer.currentTime = segment.start;
    previewEnd.current = segment.end;
    setPreviewingId(segment.id);
    void audioPlayer.play().catch(() => {
      previewEnd.current = null;
      setPreviewingId(null);
      setError('No fue posible reproducir el fragmento.');
    });
  };

  /** Only previews the seam: no export, no transcode and no server request. */
  const previewPairWithoutGap = (id: string) => {
    if (pairPreviewId === id) { stopPairPreview(); return; }
    const sorted = [...segments].sort((a, b) => a.start - b.start);
    const at = sorted.findIndex(item => item.id === id);
    const first = sorted[at];
    const second = sorted[at + 1];
    const existing = first?.ranges
      ? validStudioRanges(first, duration)
      : null;
    const plan: GaplessPairPlan | null = existing?.length === 2
      ? { first: existing[0], second: existing[1],
          skippedSeconds: existing[1].start - existing[0].end,
          selectedSeconds: studioSelectedSeconds(existing) }
      : planGaplessPair(first, second, duration);
    const element = pairPlayer.current;
    if (!plan || !element || (!first?.ranges && !second)) {
      reportTurnAction(id, 'La preescucha requiere dos cortes válidos del mismo hablante e idioma.', true);
      return;
    }
    // Do not play a turn hidden by the administrator's active filter.
    const needle = segmentSearch.trim().toLocaleLowerCase();
    if (!first?.ranges && second &&
        ((showPendingReview && second.speakerRole !== 'unknown' &&
          second.speakerRole !== 'interpreter' && second.language !== 'unknown') ||
        (needle && ![second.title, second.scriptPrompt, captionTexts[second.id] || '',
          second.speakerRole, second.language].some(value =>
          value.toLocaleLowerCase().includes(needle))))) {
      reportTurnAction(id, 'El siguiente corte está oculto: limpia los filtros para escucharlo.', true);
      return;
    }
    stopPreview();
    stopPairPreview();
    pairPlayback.current = { plan, stage: 1 };
    setPairPreviewId(id);
    element.currentTime = plan.first.start;
    setEditorPlaybackRevision(n => n + 1);
    reportTurnAction(id, first?.ranges
      ? `Preescucha de intervención compuesta: ${formatTime(plan.selectedSeconds)} de audio sin la pausa de ${formatTime(plan.skippedSeconds)}.`
      : `Preescucha local: se saltan ${formatTime(plan.skippedSeconds)} entre los dos cortes. No se modifica el proyecto.`);
    void element.play().catch(() => {
      stopPairPreview();
      reportTurnAction(id, 'El navegador no pudo iniciar la preescucha sin pausa.', true);
    });
  };

  const undoLastStructuralEdit = () => {
    if (!lastStructuralEdit) return;
    stopPreview();
    stopPairPreview();
    subtitleImportRevision.current += 1;
    setSegments(lastStructuralEdit.segments);
    setCaptionTexts(lastStructuralEdit.captions);
    setExpandedSegmentId(lastStructuralEdit.expandedId);
    setNotice(`Deshecha la última ${lastStructuralEdit.kind}. Revisa los cortes antes de exportar.`);
    setError('');
    setTurnActionFeedback(null);
    setLastStructuralEdit(null);
  };

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  useEffect(() => () => {
    silenceAbort.current?.abort();
    exportRevision.current += 1;
    exportAbort.current?.abort();
  }, []);

  // Edits invalidate the ZIP snapshot immediately: never download an older
  // package as if it reflected the current set of interventions.
  useEffect(() => {
    if (!exportAbort.current) return;
    exportRevision.current += 1;
    exportAbort.current.abort();
    exportAbort.current = null;
    setBusy(false);
    setError('La exportación se canceló porque cambiaron las intervenciones. Exporta nuevamente.');
  }, [segments]);

  const chooseAudio = (file: File) => {
    // Validate before any reset, abort or consent prompt. Invalid replacements
    // must not destroy the existing recording and unsaved interventions.
    try {
      validateLocalMedia(file);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se puede abrir este archivo.');
      return;
    }
    // Selecting another source destroys the in-memory editor and cue review.
    // A cancelled picker must never reach this action, and an actual
    // replacement should not discard substantial work without consent.
    if (audio && (segments.length > 0 || reviewCues.length > 0 || suggestedClips.length > 0) &&
        !window.confirm('Cambiar la grabación eliminará las intervenciones y sugerencias actuales. Guarda antes tu proyecto si deseas conservarlas. ¿Continuar?')) {
      return;
    }
    // Invalidate any in-flight SRT/VTT read bound to the previous audio.
    subtitleImportRevision.current += 1;
    draftOperationRevision.current += 1;
    silenceRevision.current += 1;
    exportRevision.current += 1;
    exportAbort.current?.abort();
    exportAbort.current = null;
    setBusy(false);
    silenceAbort.current?.abort();
    silenceAbort.current = null;
    setAnalyzingSilences(false);
    setServerConsent(false);
    setAllowServerZipExport(false);
    setLocalVadSnapshot(null);
    activeAudioFile.current = null;
    setDetectedSilences([]);
    setSuggestedClips([]);
    setOmittedSuggestions(0);
    stopPreview();
    stopPairPreview();
    setError('');
    setNotice('');
    setSegments([]);
    setCaptionTexts({});
    setReviewCues([]);
    setChosenCueIndices([]);
    setCuePage(0);
    setCueSearch('');
    setShowOnlySelectedCues(false);
    // Filters and the expanded editor belong to the previous source.
    // Do not let a replacement recording appear to have missing interventions.
    setSegmentSearch('');
    setShowPendingReview(false);
    setExpandedSegmentId(null);
    setTurnActionFeedback(null);
    setLastStructuralEdit(null);
    setDuration(0);
    setPlayhead(0);
    setDraftBusy(false);
    activeAudioFile.current = file;
    setAudio(file);
    setUrl(URL.createObjectURL(file));
  };

  const loadSelectedCues = (selected: TimedTranscriptCue[], excludedCount: number): boolean => {
    const prepared: Segment[] = toPublishableStudioSegments(selected).map((segment, index) => ({
      ...segment,
      id: crypto.randomUUID(),
      speakerRole: classifySpeakerRole(selected[index].speaker),
      language: 'unknown',
    }));
    // Importing a valid SRT/VTT can replace all existing edited cuts. Prompt
    // only when there is actual work to lose; never silently discard it.
    if (segments.length > 0 && !window.confirm(
      'Aplicar estos subtítulos reemplazará las intervenciones actuales. ' +
      'Guarda el proyecto si deseas conservarlas. ¿Continuar?',
    )) {
      setNotice('Importación de cortes cancelada. Las intervenciones actuales se conservaron.');
      return false;
    }
    subtitleImportRevision.current += 1;
    stopPairPreview();
    setLastStructuralEdit(null);
    setTurnActionFeedback(null);
    // A filter for the old cuts must not hide the newly imported ones.
    setSegmentSearch('');
    setShowPendingReview(false);
    setExpandedSegmentId(null);
    setSegments(prepared);
    setCaptionTexts(Object.fromEntries(prepared.map((segment, index) => [segment.id, selected[index].text])));
    setNotice(`${prepared.length} intervenciones cargadas. ${excludedCount} del intérprete original omitidas; revisa idiomas, hablantes y límites antes de exportar.`);
    return true;
  };

  const applyCueSelection = () => {
    setError('');
    try {
      const selected = selectTimedCues(reviewCues, chosenCueIndices);
      // Only dismiss the transcript review after the operator accepts the
      // replacement. A declined confirmation must preserve the selection.
      if (!loadSelectedCues(selected, 0)) return;
      setReviewCues([]);
      setChosenCueIndices([]);
      setCuePage(0);
      setCueSearch('');
      setShowOnlySelectedCues(false);
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
    if (!audio || !duration || busy || draftBusy || analyzingSilences ||
        usesLocalLongMode(audio, duration)) return;
    // The server path is never an automatic fallback. Explicit consent for
    // this exact source is necessary before any FormData audio upload occurs.
    if (!serverConsent) {
      setError('Debes autorizar expresamente el envío del MP3 al servidor.');
      return;
    }
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
      setNotice(`Análisis en servidor completado: ${pauses.length} pausas y ${proposal.clips.length} cortes sugeridos. Escucha y revisa cada intervención antes de publicarla.`);
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
    // Suggestions are estimates, not replacements for an administrator's
    // unsaved edits or an SRT/VTT selection currently under review.
    if ((segments.length > 0 || reviewCues.length > 0) &&
        !window.confirm(
          'Aplicar los cortes sugeridos reemplazará las intervenciones, notas ' +
          'y selección de subtítulos actuales. Guarda tu proyecto si quieres conservarlos. ¿Continuar?',
        )) {
      setNotice('Cortes sugeridos no aplicados. Se conservaron las intervenciones actuales.');
      return;
    }
    subtitleImportRevision.current += 1;
    stopPairPreview();
    setLastStructuralEdit(null);
    // Old filters and expanded rows must not hide the new suggestion draft.
    setSegmentSearch('');
    setShowPendingReview(false);
    setExpandedSegmentId(null);
    setTurnActionFeedback(null);
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
        // Confirm before changing existing cuts, cue-review state or filters.
        if (!loadSelectedCues(selected, excludedCount)) return;
        setCueSearch('');
        setShowOnlySelectedCues(false);
        setReviewCues([]);
        setChosenCueIndices([]);
        setCuePage(0);
      } else {
        setCueSearch('');
        setShowOnlySelectedCues(false);
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
    if (!segment) return;
    if (segment.ranges) {
      reportTurnAction(id, 'Esta intervención contiene dos cortes. Usa «Separar cortes» antes de dividir.', true);
      return;
    }
    if (segments.length >= ROLEPLAY_MAX_SCENARIOS) {
      reportTurnAction(id, `Límite de ${ROLEPLAY_MAX_SCENARIOS} intervenciones. Elimina un turno antes de dividir.`, true);
      return;
    }
    const span = segment.end - segment.start;
    if (!Number.isFinite(span) || !Number.isFinite(segment.start) ||
        !Number.isFinite(segment.end) || span < 0.2 - 1e-6 ||
        segment.start < 0 || segment.end > duration + 0.1) {
      reportTurnAction(id, 'El fragmento debe durar al menos 0,2 segundos y tener límites válidos para dividirlo.', true);
      return;
    }
    const cursor = player.current?.currentTime;
    // A click without manually positioning the cursor previously looked like
    // a broken button. Prefer a precise cursor cut; otherwise use the midpoint
    // and explain the fallback. Keep both resulting clips >= 0.1 s.
    const cursorPoint = Number.isFinite(cursor) ? Number((cursor as number).toFixed(2)) : NaN;
    const atCursor = Number.isFinite(cursorPoint) &&
      cursorPoint - segment.start >= 0.1 - 1e-6 &&
      segment.end - cursorPoint >= 0.1 - 1e-6;
    const midpoint = atCursor ? cursorPoint : Number(((segment.start + segment.end) / 2).toFixed(2));
    if (midpoint - segment.start < 0.1 - 1e-6 || segment.end - midpoint < 0.1 - 1e-6) {
      reportTurnAction(id, 'El fragmento es demasiado corto para crear dos cortes válidos.', true);
      return;
    }
    subtitleImportRevision.current += 1;
    stopPairPreview();
    setLastStructuralEdit({
      kind: 'división',
      segments: [...segments], captions: { ...captionTexts }, expandedId: expandedSegmentId,
    });
    const secondId = crypto.randomUUID();
    setSegments(previous => previous.flatMap(item => item.id === id ? [
      { ...item, end: midpoint },
      { ...item, id: secondId, start: midpoint,
        title: item.title.slice(0, 185) + ' (parte 2)' },
    ] : [item]));
    // Transcript remains private reference material in both halves; never
    // infer a word-level split or copy it to participant instructions.
    setCaptionTexts(previous => previous[id]
      ? { ...previous, [secondId]: previous[id] } : previous);
    setExpandedSegmentId(secondId);
    reportTurnAction(id, atCursor
      ? `Dividido en ${formatTime(midpoint)} (posición del cursor). Revisa ambas partes.`
      : `El cursor estaba fuera del corte; dividido en su punto medio (${formatTime(midpoint)}). Ajusta si lo necesitas.`);
  };

  const mergeWithNext = (id: string) => {
    const ordered = [...segments].sort((a, b) => a.start - b.start);
    const current = ordered.findIndex(item => item.id === id);
    const first = ordered[current];
    const second = ordered[current + 1];
    if (!first || !second) {
      reportTurnAction(id, 'Este es el último turno; no existe otro después para unir.', true);
      return;
    }
    if (first.ranges || second.ranges) {
      reportTurnAction(id, 'Para unir nuevos cortes, separa antes la intervención compuesta. El formato v2 admite dos tramos.', true);
      return;
    }
    if ((showPendingReview && !needsReview(second)) ||
        (segmentSearch.trim() && ![second.title, second.scriptPrompt, captionTexts[second.id] || '',
          second.speakerRole, second.language].some(value =>
          value.toLocaleLowerCase().includes(segmentSearch.trim().toLocaleLowerCase())))) {
      reportTurnAction(id, 'El turno siguiente está oculto por un filtro. Limpia los filtros antes de unir.', true);
      return;
    }
    if (first.speakerRole !== second.speakerRole || first.language !== second.language) {
      reportTurnAction(id, 'No se pueden unir voces o idiomas distintos. Revisa el hablante y el idioma de ambos turnos.', true);
      return;
    }
    if (second.start < first.end - 1e-6) {
      reportTurnAction(id, 'Los turnos se solapan. Ajusta sus límites antes de unirlos.', true);
      return;
    }
    const gap = second.start - first.end;
    const compound = gap > 2 + 1e-6 ? planGaplessPair(first, second, duration) : null;
    if (gap > 2 + 1e-6 && !compound) {
      reportTurnAction(id, 'La unión sin pausa no es válida. Revisa los límites y la duración total de los cortes (máximo 5 minutos).', true);
      return;
    }
    if (!compound && second.end - first.start > 300) {
      reportTurnAction(id, 'La unión superaría los 5 minutos por intervención. Reduce los límites antes de unir.', true);
      return;
    }
    const prompts = [first.scriptPrompt, second.scriptPrompt].filter(Boolean);
    const mergedPrompt = [...new Set(prompts)].join('\n\n');
    if (mergedPrompt.length > 5000) {
      reportTurnAction(id, 'Las instrucciones combinadas exceden 5.000 caracteres.', true);
      return;
    }
    subtitleImportRevision.current += 1;
    stopPairPreview();
    // A compound scene can only be exported locally. Reset an earlier
    // explicit server choice now so separating or undoing this merge never
    // silently restores an upload path.
    if (compound) setAllowServerZipExport(false);
    setLastStructuralEdit({
      kind: 'unión',
      segments: [...segments], captions: { ...captionTexts }, expandedId: expandedSegmentId,
    });
    setSegments(previous => previous.filter(item => item.id !== second.id)
      .map(item => item.id === first.id
        ? { ...item, end: second.end, scriptPrompt: mergedPrompt,
            ...(compound ? { ranges: [compound.first, compound.second] } : {}) } : item));
    setCaptionTexts(previous => {
      const next = { ...previous };
      // Rejoining previously split cues must not duplicate private text.
      const references = [previous[first.id], previous[second.id]].filter(Boolean);
      if (references.length) next[first.id] = [...new Set(references)].join(' ');
      else delete next[first.id];
      delete next[second.id];
      return next;
    });
    setExpandedSegmentId(prev => prev === second.id ? first.id : prev);
    reportTurnAction(id, compound
      ? `Intervenciones ${current + 1} y ${current + 2} unidas sin pausa: ${formatTime(compound.selectedSeconds)} de audio. Exportación local en un MP3; guarda el proyecto v2.`
      : `Unidas las intervenciones ${current + 1} y ${current + 2}. Verifica el audio resultante.`);
  };

  const separateCompound = (id: string) => {
    const segment = segments.find(item => item.id === id);
    if (!segment?.ranges) return;
    if (segments.length >= ROLEPLAY_MAX_SCENARIOS) {
      reportTurnAction(id, 'Hay 25 intervenciones. Elimina otra antes de separar esta intervención.', true);
      return;
    }
    const ranges = validStudioRanges(segment, duration);
    if (ranges?.length !== 2) {
      reportTurnAction(id, 'Los tiempos de la intervención compuesta son inválidos.', true);
      return;
    }
    subtitleImportRevision.current += 1;
    stopPreview();
    stopPairPreview();
    setLastStructuralEdit({
      kind: 'separación',
      segments: [...segments], captions: { ...captionTexts }, expandedId: expandedSegmentId,
    });
    const secondId = crypto.randomUUID();
    setSegments(previous => previous.flatMap(item => item.id === id ? [
      { ...item, ranges: undefined, start: ranges[0].start, end: ranges[0].end },
      { ...item, ranges: undefined, id: secondId,
        title: item.title.slice(0, 185) + ' (parte 2)',
        start: ranges[1].start, end: ranges[1].end,
        scriptPrompt: '' },
    ] : [item]));
    setCaptionTexts(previous => previous[id]
      ? { ...previous, [secondId]: previous[id] } : previous);
    setExpandedSegmentId(secondId);
    reportTurnAction(id, 'Cortes separados. Revisa las instrucciones y títulos antes de exportar.');
  };

  const excludeOriginalInterpreterTurns = () => {
    const excludedIds = new Set(segments.filter(item => item.speakerRole === 'interpreter')
      .map(item => item.id));
    if (!excludedIds.size) return;
    // This is an undoable bulk action; no remote export or upload is involved.
    subtitleImportRevision.current += 1;
    stopPreview();
    stopPairPreview();
    setLastStructuralEdit({
      kind: 'exclusión',
      segments: [...segments], captions: { ...captionTexts }, expandedId: expandedSegmentId,
    });
    setSegments(previous => previous.filter(item => !excludedIds.has(item.id)));
    setCaptionTexts(previous => Object.fromEntries(
      Object.entries(previous).filter(([id]) => !excludedIds.has(id)),
    ));
    setExpandedSegmentId(previous => previous && excludedIds.has(previous) ? null : previous);
    setTurnActionFeedback(null);
    setError('');
    setNotice('Intervenciones del intérprete original excluidas. Puedes deshacer antes de seguir editando.');
  };

  const addSegment = () => {
    if (segments.length >= ROLEPLAY_MAX_SCENARIOS) {
      setError('Se alcanzó el límite de intervenciones exportables.');
      return;
    }
    // Insert in the gap at/after the playhead, not only after the last clip.
    const interval = availableStudioInterval(
      duration, player.current?.currentTime ?? 0, segments,
    );
    if (!interval) {
      setError('No hay al menos 0,1 segundos libres desde el cursor. Muévelo a un espacio sin intervenciones.');
      return;
    }
    subtitleImportRevision.current += 1;
    stopPairPreview();
    setLastStructuralEdit(null);
    setTurnActionFeedback(null);
    const id = crypto.randomUUID();
    setSegments(prev => [...prev, {
      id, title: segments.some(item => item.start > interval.start)
        ? 'Corte ' + formatTime(interval.start)
        : 'Intervención ' + (prev.length + 1),
      ...interval,
      scriptPrompt: '', responseLimit: 120, speakerRole: 'unknown', language: 'unknown',
    }]);
    setExpandedSegmentId(id);
    setError('');
    setNotice('Intervención creada cerca del cursor sin solaparse con otros turnos. Revisa hablante, idioma y límites.');
  };

  const update = (id: string, patch: Partial<Segment>) => {
    if (segments.some(segment => segment.id === id && segment.ranges) &&
        (patch.start !== undefined || patch.end !== undefined)) {
      reportTurnAction(id, 'Separa los dos cortes antes de modificar sus límites.', true);
      return;
    }
    setLastStructuralEdit(null);
    stopPairPreview();
    setTurnActionFeedback(null);
    subtitleImportRevision.current += 1;
    setSegments(prev => {
      const order = [...prev].sort((a, b) => a.start - b.start);
      const index = order.findIndex(segment => segment.id === id);
      return prev.map(segment => {
        if (segment.id !== id) return segment;
        const next = { ...segment, ...patch };
        if (index >= 0 && patch.title === undefined &&
            (patch.speakerRole !== undefined || patch.language !== undefined)) {
          next.title = titleAfterProfileChange(
            segment.title, segment.speakerRole, segment.language, index,
            next.speakerRole, next.language,
          );
        }
        return next;
      });
    });
  };

  const saveDraft = async () => {
    if (!audio || !duration || busy || draftBusy) return;
    const revision = subtitleImportRevision.current;
    const operation = ++draftOperationRevision.current;
    // Persist in timeline order even if a new gap was filled after later clips.
    const snapshot = [...segments].sort((a, b) => a.start - b.start);
    setDraftBusy(true);
    setError('');
    setNotice('');
    try {
      const localOnly = usesLocalLongMode(audio, duration) ||
        snapshot.some(segment => segment.ranges !== undefined) || !allowServerZipExport;
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
      link.download = localOnly
        ? 'roleplay-studio-proyecto-largo.json' : 'roleplay-studio-proyecto.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 30000);
      setNotice(localOnly
        ? 'Plan de cortes local descargado. Próximo paso: abre el JSON y la grabación original en el exportador local actualizado para generar el ZIP, y luego impórtalo en Crear roleplay. El JSON no contiene audio ni transcripción; la huella de la fuente es parcial.'
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
      // Read the declared project format, never the editor's export mode.
      // Legacy projects should remain reopenable in today's local-first UI,
      // without silently selecting (or sending audio to) the remote exporter.
      const projectFormat = detectStudioProjectFormat(json);
      const sampledProject = projectFormat === 'sampled-local';
      if (!sampledProject && usesLocalLongMode(audio, duration)) {
        throw new Error('El proyecto antiguo con SHA-256 completo solo admite MP3 de hasta 15 MiB y 2 horas. Abre su grabación MP3 original.');
      }
      const digest = sampledProject ? await fingerprintLocalMedia(audio) : await sha256StudioAudio(audio);
      if (revision !== subtitleImportRevision.current) return;
      const restored = sampledProject
        ? openLongMediaDraft(json, audio.size, digest, duration)
        : openStudioDraft(json, audio.size, digest, duration);
      // Validate the entire project and its source fingerprint before asking
      // to replace the in-memory edits. A valid project can contain zero turns;
      // accepting it would otherwise silently erase the current work.
      if (segments.length > 0 || reviewCues.length > 0 || suggestedClips.length > 0) {
        const accepted = window.confirm(
          'El proyecto JSON es válido, pero abrirlo reemplazará las intervenciones, ' +
          'referencias y sugerencias actuales. Guarda tu trabajo antes de continuar. ¿Abrir proyecto?',
        );
        if (!accepted) {
          setNotice('Importación cancelada. Se conservaron las intervenciones y el proyecto actual.');
          return;
        }
      }
      if (revision !== subtitleImportRevision.current) return;
      const containsCompound = restored.some(segment => segment.ranges !== undefined);
      // Opening a v2 project must be local-only even after the user separates
      // its cuts. For ordinary v1 projects retain the user's chosen mode.
      if (containsCompound) setAllowServerZipExport(false);
      stopPairPreview();
      setLastStructuralEdit(null);
      setSegments(restored.map(segment => ({ ...segment, id: crypto.randomUUID() })));
      setCaptionTexts({});
      setReviewCues([]);
      setChosenCueIndices([]);
      setNotice(containsCompound
        ? `Proyecto v2 restaurado: ${restored.length} intervenciones. El modo local se activó para proteger el audio y conservar las pausas eliminadas. Usa un exportador local actualizado.`
        : sampledProject
          ? `Proyecto vinculado por tamaño, duración y huella parcial, restaurado: ${restored.length} intervenciones. El audio no se ha subido y el modo de exportación no ha cambiado.`
          : `Proyecto verificado con SHA-256 completo y restaurado: ${restored.length} intervenciones. Sin subir audio ni cambiar el modo de exportación; la transcripción no forma parte del borrador.`);
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
    if (!audio || !duration || !segments.length || busy || draftBusy || exportAbort.current) return;
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
      const ranges = validStudioRanges(segment, duration);
      if (!segment.title.trim() || segment.title.length > 200 ||
        !ranges || segment.start < end ||
        segment.scriptPrompt.length > 5000 ||
        !Number.isInteger(segment.responseLimit) || segment.responseLimit < 0 ||
        segment.responseLimit > ROLEPLAY_RESPONSE_MAX_DURATION_SEC) {
        setError('Corrige las intervenciones: orden, títulos, cortes válidos, máximo de 5 minutos de audio seleccionado y ausencia de solapamientos.');
        return;
      }
      end = segment.end;
      total += studioSelectedSeconds(ranges);
    }
    if (total > 900) {
      setError('El paquete no puede superar 15 minutos de audio acumulado.');
      return;
    }
    // Long recordings create only a local JSON draft. Do not allocate a
    // remote ZIP AbortController for this branch: otherwise the early return
    // locks all subsequent downloads until an edit resets exportAbort.
    if (usesLocalLongMode(audio, duration) ||
        ordered.some(segment => segment.ranges !== undefined) ||
        !allowServerZipExport) {
      await saveDraft();
      return;
    }
    const operation = ++exportRevision.current;
    const editorRevision = subtitleImportRevision.current;
    const controller = new AbortController();
    exportAbort.current = controller;
    const isCurrent = () => operation === exportRevision.current &&
      editorRevision === subtitleImportRevision.current && !controller.signal.aborted;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('audio', audio);
      form.append('segments', JSON.stringify(ordered.map(segment => ({
        title: segment.title, start: segment.start, end: segment.end,
        scriptPrompt: segment.scriptPrompt, responseLimit: segment.responseLimit,
      }))));
      const response = await fetch('/api/admin/roleplays/studio/export', {
        method: 'POST', credentials: 'same-origin', body: form, signal: controller.signal,
      });
      if (!isCurrent()) return;
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        if (!isCurrent()) return;
        throw new Error(body?.error || 'No se pudo exportar.');
      }
      const blob = await response.blob();
      if (!isCurrent()) return;
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
      if (isCurrent()) {
        setError(cause instanceof Error ? cause.message : 'Error al preparar el paquete.');
      }
    } finally {
      if (operation === exportRevision.current) {
        exportAbort.current = null;
        setBusy(false);
      }
    }
  };

  const sourceRequiresLocal = audio !== null && usesLocalLongMode(audio, duration);
  const hasCompound = segments.some(segment => segment.ranges !== undefined);
  const localOnly = audio !== null && (sourceRequiresLocal || hasCompound || !allowServerZipExport);
  const videoSource = audio !== null && mediaKind(audio) === 'video';
  // Retain the unfiltered SRT/VTT index for selections across pages.
  const filteredCueEntries = useMemo(() => {
    const query = cueSearch.trim().toLocaleLowerCase();
    const selectedIndices = new Set(chosenCueIndices);
    return reviewCues.flatMap((cue, index) => {
      if (showOnlySelectedCues && !selectedIndices.has(index)) return [];
      if (query && ![cue.text, cue.speaker || '', String(index + 1)]
        .some(value => value.toLocaleLowerCase().includes(query))) return [];
      return [{ cue, index }];
    });
  }, [reviewCues, cueSearch, showOnlySelectedCues, chosenCueIndices]);
  const pageCount = Math.max(1, Math.ceil(filteredCueEntries.length / CUES_PER_PAGE));
  const currentCuePage = Math.min(cuePage, pageCount - 1);
  const visibleCues = filteredCueEntries.slice(
    currentCuePage * CUES_PER_PAGE, (currentCuePage + 1) * CUES_PER_PAGE);

  const coverage = useMemo(
    () => summarizeStudioCoverage(duration,
      segments.flatMap(segment => validStudioRanges(segment, duration) ?? [])),
    [duration, segments],
  );
  const largestGaps = coverage.gaps
    .filter(gap => gap.duration >= 5)
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 8);

  // Only the selected row expands when reviewing a longer recording.
  const compactRows = compactPreference ?? (sourceRequiresLocal || segments.length >= 6);
  const query = segmentSearch.trim().toLocaleLowerCase();
  // Original-interpreter turns are not exportable, even when their speaker is
  // identified and their language is known; keep them in the pending queue.
  const needsReview = (segment: Segment) =>
    segment.speakerRole === 'unknown' || segment.speakerRole === 'interpreter' ||
    segment.language === 'unknown';
  const pendingReviewCount = segments.filter(needsReview).length;
  const originalInterpreterCount = segments.filter(
    segment => segment.speakerRole === 'interpreter',
  ).length;
  const orderedSegments = [...segments].sort((a, b) => a.start - b.start);
  const visibleSegments = orderedSegments
    .map((segment, index) => ({ segment, index }))
    .filter(({ segment }) => (!showPendingReview || needsReview(segment)) &&
      (!query || [segment.title, segment.scriptPrompt, captionTexts[segment.id] || '',
        segment.speakerRole, segment.language]
        .some(value => value.toLocaleLowerCase().includes(query))));

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
            fuentes extensas se revisan localmente. Los MP3 pequeños también se preparan sin subirlos,
            salvo que selecciones expresamente la exportación en servidor.
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
            // Browsers may dispatch a change event with no files when the
            // picker is cancelled. Preserve the existing source and edits.
            if (file) chooseAudio(file);
          }} />
        {url && (
          <div className="mt-5 space-y-3">
            {videoSource
              ? <video ref={attachPlayer} src={url} controls preload="metadata" playsInline
                  {...mediaHandlers} className="max-h-64 w-full rounded-lg bg-black"/>
              : <audio ref={attachPlayer} src={url} controls preload="metadata"
                  {...mediaHandlers} className="w-full"/>}
        {url && <audio ref={pairPlayer} src={url} preload="none"
          aria-label="Reproductor de preescucha sin pausa"
          onTimeUpdate={event => {
            const current = pairPlayback.current;
            if (!current) return;
            if (current.stage === 1 &&
                event.currentTarget.currentTime >= current.plan.first.end - 0.025) {
              current.stage = 2;
              event.currentTarget.currentTime = current.plan.second.start;
            } else if (current.stage === 2 &&
                       event.currentTarget.currentTime >= current.plan.second.end - 0.025) {
              stopPairPreview();
            }
          }}
          onEnded={() => stopPairPreview()}
          onPause={() => {
            if (pairPlayer.current?.paused) {
              pairPlayback.current = null;
              setPairPreviewId(null);
            }
          }}
          onError={() => {
            if (!pairPlayback.current) return;
            stopPairPreview();
            setError('El navegador no pudo reproducir la preescucha. Comprueba el formato de la grabación.');
          }}
          className="hidden" />}
            {audio && duration > 0 && !sourceRequiresLocal && !hasCompound && (
              <fieldset aria-label="Modo de exportación del MP3" className="rounded-lg border border-white/15 bg-slate-950/60 p-3">
                <legend className="px-1 text-sm font-semibold text-white">Dónde preparar el ZIP</legend>
                <label className="flex items-start gap-2 text-sm text-cyan-100">
                  <input type="radio" name="studio-export-location"
                    checked={!allowServerZipExport}
                    onChange={() => {
                      subtitleImportRevision.current += 1;
                      draftOperationRevision.current += 1;
                      exportRevision.current += 1;
                      exportAbort.current?.abort();
                      exportAbort.current = null;
                      setBusy(false);
                      setDraftBusy(false);
                      setAllowServerZipExport(false);
                      setError('');
                      setNotice('Modo local: descarga el JSON y genera el ZIP en tu equipo con el exportador de escritorio.');
                    }}
                    className="mt-1 accent-cyan-400"/>
                  Local (predeterminado): no subir el MP3. Descarga el proyecto JSON y genera el ZIP en tu equipo.
                </label>
                <label className="mt-2 flex items-start gap-2 text-sm text-slate-200">
                  <input type="radio" name="studio-export-location"
                    checked={allowServerZipExport}
                    onChange={() => {
                      subtitleImportRevision.current += 1;
                      draftOperationRevision.current += 1;
                      exportRevision.current += 1;
                      exportAbort.current?.abort();
                      exportAbort.current = null;
                      setBusy(false);
                      setDraftBusy(false);
                      setAllowServerZipExport(true);
                      setError('');
                      setNotice('Modo servidor seleccionado: al exportar, el MP3 se enviará para generar el ZIP.');
                    }}
                    className="mt-1 accent-blue-400"/>
                  Servidor (opcional): el MP3 se subirá al exportar y consumirá recursos de la plataforma.
                </label>
              </fieldset>
            )}
            {localOnly && duration > 0 && (
              <div className="rounded-lg border border-cyan-400/20 bg-cyan-400/5 px-3 py-2 text-xs leading-5 text-cyan-100">
                {hasCompound && (
                  <p className="mb-2 font-semibold text-amber-100">
                    Proyecto compuesto v2: la exportación local se ha activado automáticamente.
                    Usa un exportador actualizado para que el MP3 omita las pausas; la grabación no se envía al servidor.
                  </p>
                )}
                <strong>Preparación local:</strong> la grabación no se sube al servidor.
                Puedes revisar, marcar y guardar los cortes sin decodificar el archivo completo.
                El JSON no contiene audio ni video. Para generar el ZIP, extrae los clips con
                FFmpeg en tu equipo; esta opción no convierte audio en el navegador.
                <p className="mt-2 font-medium text-white">
                  Paso 1: descarga el proyecto JSON. Paso 2: genera el ZIP junto a tu grabación
                  original en el exportador local. Paso 3: importa el ZIP desde «Crear roleplay».
                </p>
                <a
                  href="https://github.com/tadtaxiadvertising/interpretes-rd/blob/main/tools/roleplay-studio-desktop/README.md"
                  target="_blank" rel="noopener noreferrer"
                  className="mt-1 inline-block font-semibold text-cyan-200 underline underline-offset-2">
                  Cómo obtener el exportador local actualizado
                </a>
                <details className="mt-2 rounded border border-cyan-300/15 px-2 py-1">
                  <summary className="cursor-pointer font-semibold">Cómo generar el ZIP sin subir el original</summary>
                  <p className="mt-2">
                    Opción con interfaz gráfica: cuando el mantenedor haya generado y verificado
                    la aplicación de escritorio, ábrela y pulsa «Elegir grabación + JSON».
                    Selecciona ambos archivos una vez: se propondrá un nombre ZIP disponible.
                    Pulsa «Generar ZIP local»; no requiere comandos ni subir la grabación.
                  </p>
                  <details className="mt-2 rounded border border-cyan-300/15 px-2 py-1">
                    <summary className="cursor-pointer">Alternativa técnica con Node.js</summary>
                    <p className="mt-1">En un equipo con el repositorio instalado, ejecuta:</p>
                    <code className="mt-1 block break-all rounded bg-slate-950/70 p-2 text-[11px] text-slate-200">
                      node scripts/export-studio-long-local.mjs --source llamada.mp4 --project roleplay-studio-proyecto-largo.json --output roleplay-studio.zip
                    </code>
                  </details>
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
                onLocalVadResult={(source, snapshot) => {
                  if (activeAudioFile.current === source) setLocalVadSnapshot(snapshot);
                }}
              />
            )}
            <p className="text-xs text-slate-400">
              Duración: {formatTime(duration)} · Navega por la línea de tiempo
              y marca los límites en el cursor. El zoom no decodifica el archivo completo.
            </p>
            {segments.length > 0 && (
              <section aria-label="Resumen de cortes y espacios" className="rounded-lg border border-cyan-300/15 bg-slate-950/50 p-2.5">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                  <span className="font-semibold text-cyan-100">
                    Seleccionado: {formatTime(coverage.selectedSeconds)}
                  </span>
                  <span className="text-slate-300">
                    Fuera de cortes: {formatTime(coverage.excludedSeconds)}
                  </span>
                  <span className="text-slate-400">
                    {segments.length} intervenciones
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  El paquete reúne únicamente los cortes seleccionados, sin los espacios intermedios.
                  Los intervalos fuera de cortes pueden contener conversaciones: no son silencios detectados.
                </p>
                {coverage.hasOverlaps && (
                  <p className="mt-1 text-xs font-semibold text-amber-200">
                    Hay intervenciones solapadas. Corrige sus límites antes de exportar.
                  </p>
                )}
                {largestGaps.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-medium text-cyan-200">
                      Revisar los {largestGaps.length} espacios sin cortes más extensos (al menos 5 s)
                    </summary>
                    <div className="mt-2 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                      {largestGaps.map(gap => (
                        <button key={`${gap.start}-${gap.end}`} type="button"
                          onClick={() => seekAudio(gap.start + Math.min(2, gap.duration / 2))}
                          aria-label={`Escuchar espacio sin cortes desde ${formatTime(gap.start)}`}
                          className="rounded border border-white/15 px-2 py-1 text-xs text-slate-300 hover:border-cyan-300/40">
                          {formatTime(gap.start)}–{formatTime(gap.end)}
                          <span className="ml-1 text-cyan-200">({formatTime(gap.duration)})</span>
                        </button>
                      ))}
                    </div>
                  </details>
                )}
              </section>
            )}
            {audio && !sourceRequiresLocal && (
              <LocalVadAssistant
                key={url}
                snapshot={localVadSnapshot}
                duration={duration}
                existing={segments}
                onApply={(detected) => {
                  if (!detected.length) return;
                  subtitleImportRevision.current += 1;
                  stopPairPreview();
                  setLastStructuralEdit(null);
                  setSegments(prev => [...prev, ...detected.map((item, index) => ({
                    id: crypto.randomUUID(),
                    title: 'Intervención ' + (prev.length + index + 1),
                    start: item.start,
                    end: item.end,
                    scriptPrompt: '',
                    responseLimit: 120,
                    speakerRole: 'unknown' as const,
                    language: 'unknown' as const,
                  }))]);
                  setNotice('Cortes VAD añadidos sin solaparse con los anteriores. Revisa hablantes, idioma y límites antes de exportar.');
                }}
              />
            )}
            {!sourceRequiresLocal && <div className="rounded-xl border border-violet-400/20 bg-violet-400/5 p-4">
              <h2 className="text-sm font-bold text-violet-100">Respaldo opcional: detección en servidor</h2>
              <p className="mt-2 text-xs leading-5 text-slate-300">
                Utiliza el detector local anterior para no subir la grabación ni consumir
                recursos del servidor. Si el navegador no puede decodificar el MP3,
                puedes autorizar un análisis temporal con FFmpeg en nuestro servidor.
                No transcribe ni identifica al médico, paciente o intérprete.
                No se guarda en la biblioteca, pero el archivo sí se transmite para procesarlo.
              </p>
              <label className="mt-3 flex items-start gap-2 text-xs leading-5 text-slate-200">
                <input type="checkbox" className="mt-1 accent-violet-400"
                  checked={serverConsent}
                  onChange={event => {
                    const allowed = event.currentTarget.checked;
                    setServerConsent(allowed);
                    if (!allowed) {
                      silenceRevision.current += 1;
                      silenceAbort.current?.abort();
                      silenceAbort.current = null;
                      setAnalyzingSilences(false);
                      setDetectedSilences([]);
                      setSuggestedClips([]);
                      setOmittedSuggestions(0);
                    }
                  }}
                  aria-label="Autorizo subir este MP3 al servidor para detectar pausas" />
                Autorizo enviar este MP3 al servidor únicamente para detectar pausas.
                La autorización no se conserva al cambiar de grabación.
              </label>
              <button type="button" onClick={() => void analyzeSilences()}
                disabled={!serverConsent || analyzingSilences || busy || draftBusy}
                className="mt-3 rounded-lg border border-violet-300/30 bg-violet-500/20 px-4 py-2 text-sm font-semibold text-violet-100 disabled:opacity-50">
                {analyzingSilences ? 'Analizando pausas…' : 'Detectar pausas en servidor'}
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
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-300">
            <input type="search" aria-label="Buscar turnos en transcripción"
              value={cueSearch} placeholder="Buscar texto, hablante o número…"
              onChange={event => { setCueSearch(event.currentTarget.value); setCuePage(0); }}
              className="min-w-0 flex-1 rounded-md border border-white/15 bg-slate-900 px-2 py-1.5 text-white placeholder:text-slate-500"/>
            <label className="flex shrink-0 items-center gap-1.5">
              <input type="checkbox" checked={showOnlySelectedCues}
                onChange={event => { setShowOnlySelectedCues(event.currentTarget.checked); setCuePage(0); }}
                className="h-4 w-4 accent-amber-400"/>
              Solo seleccionados
            </label>
          </div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300">
            <span>
              {filteredCueEntries.length
                ? `Mostrando ${currentCuePage * CUES_PER_PAGE + 1}–${Math.min((currentCuePage + 1) * CUES_PER_PAGE, filteredCueEntries.length)} de ${filteredCueEntries.length} turnos`
                : 'Ningún turno coincide con los filtros'}
              {filteredCueEntries.length !== reviewCues.length ? ` · ${reviewCues.length} en origen` : ''}
            </span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setCuePage(page => Math.max(0, page - 1))}
                disabled={currentCuePage === 0} className="rounded border border-white/15 px-2 py-1 disabled:opacity-30">
                Anterior
              </button>
              <label className="flex items-center gap-1">
                Página
                <input type="number" aria-label="Página de intervenciones SRT"
                  min={1} max={pageCount} value={currentCuePage + 1}
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
                disabled={currentCuePage >= pageCount - 1}
                className="rounded border border-white/15 px-2 py-1 disabled:opacity-30">
                Siguiente
              </button>
            </div>
          </div>
          <div className="max-h-80 space-y-2 overflow-y-auto rounded-xl border border-white/10 bg-slate-950/70 p-3">
            {visibleCues.map(({ cue, index }) => {
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
              Abrir proyecto JSON de la grabación seleccionada
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
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-slate-200">
                <input type="checkbox" checked={showPendingReview}
                  onChange={event => setShowPendingReview(event.currentTarget.checked)}
                  className="accent-blue-500"/>
                Pendientes ({pendingReviewCount})
              </label>
              <button type="button" onClick={() => setCompactPreference(!compactRows)}
                aria-pressed={compactRows}
                className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-slate-200">
                {compactRows ? 'Vista detallada' : 'Vista compacta'}
              </button>
              {lastStructuralEdit && (
                <button type="button" onClick={undoLastStructuralEdit}
                  aria-label={lastStructuralEdit.kind === 'exclusión'
                    ? 'Deshacer exclusión de intérpretes' : 'Deshacer última división o unión'}
                  className="rounded-lg border border-amber-400/30 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-400/10">
                  Deshacer {lastStructuralEdit.kind}
                </button>
              )}
              <button type="button" onClick={addSegment} disabled={segments.length >= ROLEPLAY_MAX_SCENARIOS}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"><Plus size={16}/> Añadir intervención</button>
            </div>
          </div>
          <details open={!sourceRequiresLocal} className="space-y-3 rounded-lg border border-teal-400/20 bg-teal-400/5 p-3">
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
          {originalInterpreterCount > 0 && (
            <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-xs text-amber-100">
              <p>
                {originalInterpreterCount} {originalInterpreterCount === 1 ? 'turno identificado' : 'turnos identificados'}
                {' '}como intérprete original. Excluye esos fragmentos antes de exportar el roleplay.
              </p>
              <button type="button" onClick={excludeOriginalInterpreterTurns}
                className="rounded-lg border border-amber-300/40 px-3 py-2 font-semibold text-amber-100 hover:bg-amber-400/10">
                Excluir {originalInterpreterCount} {originalInterpreterCount === 1 ? 'intervención' : 'intervenciones'} del intérprete
              </button>
            </div>
          )}
          {segments.length > 0 && (
            <p className="text-xs text-slate-400">
              Cursor: <span className="font-medium text-cyan-200">{formatTime(playhead)}</span>.
              {' '}«Dividir» corta en el cursor cuando está dentro del turno; fuera de él usa el punto medio.
              {' '}«Unir» combina turnos compatibles. Si están separados por más de 2 s,
              crea un único MP3 sin la pausa al exportar localmente el proyecto v2.
            </p>
          )}
          {segments.length === 0 && <p className="text-sm text-slate-400">Añade una intervención, define inicio y final en segundos y comprueba su título.</p>}
          {segments.length > 0 && visibleSegments.length === 0 && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-400">
              <span>{showPendingReview && pendingReviewCount === 0
                ? 'Todas las intervenciones tienen hablante e idioma revisados.'
                : 'No hay intervenciones que coincidan con los filtros.'}</span>
              {(showPendingReview || segmentSearch) && (
                <button type="button" onClick={() => { setShowPendingReview(false); setSegmentSearch(''); }}
                  className="rounded-md border border-white/15 px-2 py-1 text-blue-200">Limpiar filtros</button>
              )}
            </div>
          )}
          {segments.length >= 6 && (
            <p className="text-xs text-slate-400">
              {visibleSegments.length} de {segments.length} turnos. Identifica hablante e idioma
              en la fila compacta; abre «Editar» para ajustar tiempos e instrucciones.
            </p>
          )}
          {visibleSegments.map(({ segment, index }) => (
            <article key={segment.id} className="space-y-2 rounded-lg border border-white/10 bg-slate-950/70 p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-white">
                  #{index + 1} · {segment.title}
                  <span className="ml-2 text-xs font-normal text-slate-400">
                    {segment.ranges
                      ? segment.ranges.map(range => formatTime(range.start) + '–' + formatTime(range.end)).join(' + ')
                      : formatTime(segment.start) + '–' + formatTime(segment.end)}
                    {' · '}{segment.speakerRole} · {segment.language.toUpperCase()}
                  </span>
                  {captionTexts[segment.id] && compactRows && (
                    <span className="ml-2 inline-block max-w-64 truncate align-bottom text-xs font-normal text-amber-200/80">
                      {captionTexts[segment.id]}
                    </span>
                  )}
                </h3>
                <button type="button" onClick={() => seekAudio(segment.start)}
                  aria-label={'Ir al inicio de intervención ' + (index + 1)}
                  className="rounded-md border border-white/15 px-2 py-1 text-xs text-slate-300">
                  Ir al inicio
                </button>
                <button type="button" onClick={() => splitAtPlayhead(segment.id)}
                  disabled={Boolean(segment.ranges)}
                  aria-label={'Dividir intervención ' + (index + 1) + ' en cursor o punto medio'}
                  title={segment.ranges ? 'Separa los dos cortes antes de dividir' : 'Divide en cursor o punto medio'}
                  className="rounded-md border border-white/15 px-2 py-1 text-xs text-slate-300">
                  Dividir
                </button>
                <button type="button" onClick={() => mergeWithNext(segment.id)}
                  disabled={Boolean(segment.ranges)}
                  aria-label={'Unir intervención ' + (index + 1) + ' con siguiente'}
                  title={segment.ranges ? 'Separa los dos cortes antes de añadir otro' : 'Une con el siguiente turno visible; omite pausas largas en el MP3 local'}
                  className="rounded-md border border-white/15 px-2 py-1 text-xs text-slate-300">
                  {orderedSegments[index + 1] &&
                    orderedSegments[index + 1].start - segment.end > 2 ? 'Unir sin pausa' : 'Unir'}
                </button>
                {segment.ranges && (
                  <button type="button" onClick={() => separateCompound(segment.id)}
                    aria-label={'Separar cortes de intervención ' + (index + 1)}
                    className="rounded-md border border-amber-400/30 px-2 py-1 text-xs text-amber-100">
                    Separar cortes
                  </button>
                )}
                {orderedSegments[index + 1] &&
                  visibleSegments.some(item => item.segment.id === orderedSegments[index + 1].id) &&
                  planGaplessPair(segment, orderedSegments[index + 1], duration) && (
                    <button type="button"
                      onClick={() => previewPairWithoutGap(segment.id)}
                      aria-label={'Preescuchar intervenciones ' + (index + 1) + ' y ' + (index + 2) + ' sin pausa'}
                      aria-pressed={pairPreviewId === segment.id}
                      title="Preescucha dos cortes; usa Unir sin pausa para generar una intervención física en el proyecto v2"
                      className="rounded-md border border-cyan-400/30 px-2 py-1 text-xs text-cyan-200 hover:bg-cyan-400/10">
                      {pairPreviewId === segment.id ? 'Detener preescucha' : 'Escuchar sin pausa'}
                    </button>
                  )}
                {compactRows && (
                  <>
                    <button type="button" onClick={() => previewSegment(segment)}
                      className="rounded-md border border-emerald-400/25 px-2 py-1 text-xs text-emerald-200">
                      {segment.ranges
                        ? pairPreviewId === segment.id ? 'Detener unión' : 'Escuchar unido'
                        : previewingId === segment.id ? 'Detener fragmento' : 'Escuchar fragmento'}
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
                  stopPairPreview();
                  setLastStructuralEdit(null);
                  setSegments(prev => prev.filter(s => s.id !== segment.id));
                  // Discard the deleted turn's private transcript reference.
                  setCaptionTexts(prev => {
                    if (!Object.prototype.hasOwnProperty.call(prev, segment.id)) return prev;
                    const next = { ...prev };
                    delete next[segment.id];
                    return next;
                  });
                  setExpandedSegmentId(prev => prev === segment.id ? null : prev);
                  setTurnActionFeedback(null);
                }}
                  className="rounded-lg p-2 text-red-300 hover:bg-red-500/10"><Trash2 size={16}/></button>
              </div>
              {orderedSegments[index + 1] &&
                visibleSegments.some(item => item.segment.id === orderedSegments[index + 1].id) &&
                planGaplessPair(segment, orderedSegments[index + 1], duration) && (
                  <p className="text-xs text-cyan-200/80">
                    Pausa entre ambos cortes: {formatTime(orderedSegments[index + 1].start - segment.end)}.
                    Puedes preescucharlos o pulsar «Unir sin pausa» para generar un único MP3 en el exportador local.
                  </p>
                )}
              {segment.ranges && (
                <p className="text-xs text-amber-100">
                  Intervención compuesta · {formatTime(studioSelectedSeconds(segment.ranges))} de audio útil;
                  pausa de {formatTime(segment.ranges[1].start - segment.ranges[0].end)} excluida.
                  El proyecto v2 se exporta como un único MP3 con el exportador local actualizado.
                  Para ajustar los tiempos, selecciona «Separar cortes».
                </p>
              )}
              {turnActionFeedback?.id === segment.id && (
                <p
                  role={turnActionFeedback.error ? 'alert' : 'status'}
                  className={turnActionFeedback.error
                    ? 'rounded-md border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs text-amber-100'
                    : 'rounded-md border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-100'}>
                  {turnActionFeedback.message}
                </p>
              )}
              {compactRows && expandedSegmentId !== segment.id && (
                <div className="flex flex-wrap items-center gap-2 border-t border-white/5 pt-2">
                  <label className="flex min-w-[180px] flex-1 items-center gap-2 text-xs text-slate-300">
                    <span className="shrink-0">Hablante</span>
                    <select aria-label={'Hablante rápido intervención ' + (index + 1)}
                      value={segment.speakerRole}
                      onChange={event => update(segment.id, {
                        speakerRole: event.target.value as StudioSpeakerRole,
                      })}
                      className="min-w-0 flex-1 rounded-md border border-white/15 bg-slate-900 px-2 py-1.5 text-xs text-white">
                      <option value="unknown">Por identificar</option>
                      <option value="doctor">Médico</option>
                      <option value="patient">Paciente</option>
                      <option value="nurse">Enfermería</option>
                      <option value="operator">Operador</option>
                      <option value="interpreter">Intérprete original — excluir</option>
                    </select>
                  </label>
                  <label className="flex min-w-[140px] flex-1 items-center gap-2 text-xs text-slate-300">
                    <span className="shrink-0">Idioma</span>
                    <select aria-label={'Idioma rápido intervención ' + (index + 1)}
                      value={segment.language}
                      onChange={event => update(segment.id, {
                        language: event.target.value as StudioLanguage,
                      })}
                      className="min-w-0 flex-1 rounded-md border border-white/15 bg-slate-900 px-2 py-1.5 text-xs text-white">
                      <option value="unknown">Por revisar</option>
                      <option value="en">Inglés (EN)</option>
                      <option value="es">Español (ES)</option>
                    </select>
                  </label>
                </div>
              )}
              {(!compactRows || expandedSegmentId === segment.id) && (
              <div className="space-y-2 border-t border-white/5 pt-2">
              <label className="block text-sm text-slate-300">Título
                <input value={segment.title} maxLength={200} onChange={event => update(segment.id, {title: event.target.value})}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-white"/>
              </label>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="text-sm text-slate-300">Inicio (segundos)
                  <input type="number" min={0} max={duration} step="0.1" value={segment.start}
                    disabled={Boolean(segment.ranges)}
                    onChange={event => update(segment.id, {start: event.target.valueAsNumber})}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-white"/>
                </label>
                <label className="text-sm text-slate-300">Final (segundos)
                  <input type="number" min={0} max={duration} step="0.1" value={segment.end}
                    disabled={Boolean(segment.ranges)}
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
                  disabled={Boolean(segment.ranges)}
                  onClick={() => markAtPlayhead(segment.id, 'start')}>Marcar inicio actual</button>
                <button type="button" className="rounded-lg border border-blue-400/25 px-3 py-2 text-blue-200 hover:bg-blue-500/10"
                  disabled={Boolean(segment.ranges)}
                  onClick={() => markAtPlayhead(segment.id, 'end')}>Marcar fin actual</button>
                {!compactRows && (
                  <button type="button" className="rounded-lg border border-emerald-400/25 px-3 py-2 text-emerald-200 hover:bg-emerald-500/10"
                    onClick={() => previewSegment(segment)}>
                    {segment.ranges
                      ? pairPreviewId === segment.id ? 'Detener unión' : 'Escuchar unido'
                      : previewingId === segment.id ? 'Detener fragmento' : `Escuchar fragmento (${formatTime(segment.start)}–${formatTime(segment.end)})`}
                  </button>
                )}
              </div>
              </div>
              )}
            </article>
          ))}
          {segments.length > 0 && !sourceRequiresLocal && !hasCompound && (
            <StudioConsecutivePreview
              sourceUrl={url}
              sourceDuration={duration}
              segments={segments}
              interruptRevision={editorPlaybackRevision}
              onStart={pauseEditorialAudio}
            />
          )}
          {hasCompound && !sourceRequiresLocal && (
            <p className="text-xs text-amber-200">
              El simulador consecutivo de intervalos continuos está deshabilitado para proyectos compuestos.
              Utiliza «Escuchar unido» para revisar cada unión física antes de generar el ZIP local.
            </p>
          )}
          {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
          {notice && <p role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-100">{notice}</p>}
          <button type="button" onClick={() => void exportPackage()} disabled={busy || analyzingSilences || !segments.length}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 font-bold text-white hover:bg-emerald-500 disabled:opacity-50">
            <Download size={18} /> {busy
              ? 'Procesando segmentos…'
              : localOnly ? 'Descargar plan local de cortes (JSON)' : 'Exportar MP3 + manifiesto ZIP (envía MP3 al servidor)'}
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
