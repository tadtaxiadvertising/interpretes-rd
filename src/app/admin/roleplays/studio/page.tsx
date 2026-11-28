'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStudioPlayback } from './useStudioPlayback';
import { focusStudioIntervention, isStudioShortcutTarget } from './studio-editor-focus';
import Link from 'next/link';
import { readAudioStudioEditorPreferences } from '@/app/actions/audio-studio-settings';
import { ArrowLeft, AudioLines, Plus } from 'lucide-react';
import { ROLEPLAY_MAX_SCENARIOS, ROLEPLAY_RESPONSE_MAX_DURATION_SEC } from '@/lib/roleplay-limits';
import {
  parseTimedTranscriptForReviewWithDiagnostics, toPublishableStudioSegments,
  type TimedTranscriptCue,
} from '@/lib/roleplay-studio/transcript';
import { fillCompatibleTimedCueSelection, selectTimedCues, suggestRepresentativeTimedCueSelection } from '@/lib/roleplay-studio/cue-selection';
import { cueRequiresEditorialReview, overlappingSelectedTimedCueIndices, summarizeTimedCueReview } from '@/lib/roleplay-studio/cue-review-summary';
import { availableStudioInterval } from '@/lib/roleplay-studio/available-interval';
import { summarizeStudioCoverage } from '@/lib/roleplay-studio/coverage';
import { proposeStudioBoundaries } from '@/lib/roleplay-studio/boundary-proposals';
import { restoreExcludedIssue, STUDIO_MAX_EXCLUDED_TURNS } from '@/lib/roleplay-studio/editorial-trash';
import { useStudioLocalRecovery, type RestoredStudioRecovery } from './useStudioLocalRecovery';
import { studioReviewIssue, nextUnconfirmedTurn, inspectStudioReview, type StudioReviewCode } from '@/lib/roleplay-studio/quick-review';
import { sourceSpeakerGroup, propagateSpeakerProfile } from '@/lib/roleplay-studio/speaker-groups';
import { planStudioPublicationParts, STUDIO_PACKAGE_AUDIO_SECONDS, type StudioPublicationPart } from '@/lib/roleplay-studio/publication-parts';
import { planGaplessPair, type GaplessPairPlan } from '@/lib/roleplay-studio/gapless-pair-preview';
import { validStudioRanges, studioSelectedSeconds } from '@/lib/roleplay-studio/compound-cuts';
import { formatStudioTime as formatTime } from '@/lib/roleplay-studio/format-time';
import { happyScribeProofExpiry, happyScribeReady, type HappyScribeLibraryItem } from '@/lib/roleplay-studio/happyscribe-library';
import { happyScribeImportFilename } from '@/lib/roleplay-studio/happyscribe-filename';
import {
  addStudioProtocol, type StudioProtocolKind, type StudioProtocolLanguage,
} from '@/lib/roleplay-studio/protocols';
import {
  suggestStudioClips, type StudioSilence, type StudioSuggestedClip,
} from '@/lib/roleplay-studio/silence-analysis';
import StudioWaveform from './StudioWaveform';
import HappyScribeLibraryPanel from './HappyScribeLibraryPanel';
import StudioFinalizationPanel from './StudioFinalizationPanel';
import StudioFocusNavigation from './StudioFocusNavigation';
import StudioWorkspaceHeader from './StudioWorkspaceHeader';
import StudioInterventionCard, { type StudioIntervention as Segment } from './StudioInterventionCard';
import { useStudioCardActions } from './useStudioCardActions';
import { STUDIO_HISTORY_LIMIT } from '@/lib/roleplay-studio/editorial-history';
import { useStudioEditorialHistory, hasRecoverableUndo, type EditorialSnapshot } from './useStudioEditorialHistory';
import { canPrepareLocalMp3, decodeLocalMp3ForAssignment } from '@/lib/roleplay-studio/local-mp3-assignment';
import { prepareLocalWavAssignment, planLocalWavParts, type LocalWavPart } from '@/lib/roleplay-studio/local-wav-assignment';
import { studioProductionKey, productionStatus, trackProductionTransfer } from '@/lib/roleplay-studio/production-tracking';
import StudioTopicPicker from './StudioTopicPicker';
import { parseEditorialRoleplayTopic } from '@/lib/roleplay-library-topics';
import { stageStudioHandoff, stageLocalWavHandoff, STUDIO_HANDOFF_MAX_BYTES, type StudioTopicSelection } from '@/lib/roleplay-studio/assignment-handoff';
import FocusTimeline from './FocusTimeline';
import type { LocalVadSnapshot } from '@/lib/roleplay-studio/local-vad';
import LocalVadAssistant from './LocalVadAssistant';
import StudioConsecutivePreview from './StudioConsecutivePreview';
import { detectStudioProjectFormat } from '@/lib/roleplay-studio/project-format';
import {
  createStudioDraft, openStudioDraft, sha256StudioAudio, MAX_STUDIO_DRAFT_CHARS, STUDIO_MAX_EDITOR_SEGMENTS,
} from '@/lib/roleplay-studio/draft';
import {
  createLongMediaDraft, openLongMediaDraft, fingerprintLocalMedia, mediaKind,
  usesLocalLongMode, validateLocalMedia,
} from '@/lib/roleplay-studio/long-media';
import {
  classifySpeakerRole, filterInterpreterCues,
  titleAfterProfileChange, studioProfileSearchText, studioEditorialProfile, studioProfileSelection, hasStudioProfileLanguageMismatch, type StudioLanguage,
} from '@/lib/roleplay-studio/speaker-profiles';







// Original-interpreter turns are not exportable, even when their speaker is
// identified and their language is known; keep them in the pending queue.
const needsReview = (segment: Segment) =>
  segment.speakerRole === 'unknown' || segment.speakerRole === 'interpreter' ||
  segment.language === 'unknown' || hasStudioProfileLanguageMismatch(segment.speakerRole, segment.language);

export default function RoleplayStudioPage() {
  const [audio, setAudio] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [duration, setDuration] = useState(0);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [excludedTurns, setExcludedTurns] = useState<Array<{ turn: Segment; caption?: string }>>([]);
  const excludedTimelineTurns = useMemo(() => excludedTurns.map(entry => entry.turn), [excludedTurns]);
  const [trashOpen, setTrashOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [reviewCenterOpen, setReviewCenterOpen] = useState(false);
  const [reviewCategory, setReviewCategory] = useState<'all' | 'unconfirmed' | StudioReviewCode>('all');
  // Confirmation belongs to this editing session, not to the published payload.
  const [confirmedTurns, setConfirmedTurns] = useState<ReadonlyMap<string, Segment>>(() => new Map());
  const [expandedEditor, setExpandedEditor] = useState(false);
  const [publicationPartKey, setPublicationPartKey] = useState('');
  const [editorialTopic, setEditorialTopic] = useState<StudioTopicSelection>({ topic: '', subtopic: '' });
  const genericPublicationPlan = useMemo(() => planStudioPublicationParts(segments, duration), [segments, duration]);
  const [wavPlan, setWavPlan] = useState<{ source: File; cuts: Segment[]; parts: LocalWavPart<Segment>[]; issue: string | null } | null>(null);
  const [convertedMp3, setConvertedMp3] = useState<{ original: File; wav: File } | null>(null);
  const localMp3Eligible = Boolean(audio && canPrepareLocalMp3(audio, duration));
  const localWavSource = audio && /\.wav$/i.test(audio.name) ? audio :
    convertedMp3 && convertedMp3.original === audio ? convertedMp3.wav : null;
  const wavSource = localWavSource !== null;
  const currentWavPlan = wavPlan && wavPlan.source === localWavSource && wavPlan.cuts === segments ? wavPlan : null;
  useEffect(() => { setConvertedMp3(null); }, [audio]);
  useEffect(() => {
    if (!localWavSource || !duration || !segments.length) { setWavPlan(null); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void planLocalWavParts(localWavSource, segments, controller.signal).then(parts => {
        if (!controller.signal.aborted) setWavPlan({ source: localWavSource, cuts: segments, parts, issue: null });
      }).catch(cause => {
        if (!controller.signal.aborted) setWavPlan({ source: localWavSource, cuts: segments, parts: [],
          issue: cause instanceof Error ? cause.message : 'No se pudo calcular el tamaño WAV.' });
      });
    }, 150);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [localWavSource, duration, segments]);
  const publicationPlan = currentWavPlan && !currentWavPlan.issue ? currentWavPlan : genericPublicationPlan;
  useEffect(() => {
    if (currentWavPlan && !currentWavPlan.issue && currentWavPlan.parts.length > 1 &&
        !currentWavPlan.parts.some(part => part.key === publicationPartKey)) {
      setPublicationPartKey(currentWavPlan.parts[0].key);
    }
  }, [currentWavPlan, publicationPartKey]);
  const selectedPublicationPart = publicationPlan.parts.find(part => part.key === publicationPartKey);
  const editorLimit = expandedEditor ? STUDIO_MAX_EDITOR_SEGMENTS : ROLEPLAY_MAX_SCENARIOS;
  const selectionPurpose = expandedEditor ? 'editor' : 'package';
  const [busy, setBusy] = useState(false);
  const [draftBusy, setDraftBusy] = useState(false);
  const [analyzingSilences, setAnalyzingSilences] = useState(false);
  const [serverConsent, setServerConsent] = useState(false);
  const [allowServerZipExport, setAllowServerZipExport] = useState(false);
  const [productionKeys, setProductionKeys] = useState<{ source: File; cuts: Segment[]; mode: 'wav' | 'mp3'; keys: Map<string, string> } | null>(null);
  const [assignmentPackage, setAssignmentPackage] = useState<({ token: string; revision: number; source: File; cuts: Segment[]; partKey?: string } & ({ file: File; files?: never } | { files: File[]; file?: never })) | null>(null);
  const [localVadSnapshot, setLocalVadSnapshot] = useState<LocalVadSnapshot | null>(null);
  const [detectedSilences, setDetectedSilences] = useState<StudioSilence[]>([]);
  const [suggestedClips, setSuggestedClips] = useState<StudioSuggestedClip[]>([]);
  const [omittedSuggestions, setOmittedSuggestions] = useState(0);
  const [protocolKind, setProtocolKind] = useState<StudioProtocolKind>('opening');
  const [protocolLanguage, setProtocolLanguage] = useState<StudioProtocolLanguage>('en');
  const [error, setError] = useState('');
  const {
    player, pairPlayer, attachPlayer, pauseEditorialAudio, playhead, setPlayhead,
    editorPlaybackRevision, previewingId, pairPreviewId, stopPreview, stopPairPreview, seekAudio,
    previewSimpleSegment, previewSubtitleCue, previewVadRegion, startPairPreview, mediaHandlers, pairMediaHandlers,
  } = useStudioPlayback(duration, setDuration, setError);
  const [notice, setNotice] = useState('');
  const [captionTexts, setCaptionTexts] = useState<Record<string, string>>({});
  const [excludeInterpreter, setExcludeInterpreter] = useState(true);
  const [reviewCues, setReviewCues] = useState<TimedTranscriptCue[]>([]);
  const [chosenCueIndices, setChosenCueIndices] = useState<number[]>([]);
  const [cuePage, setCuePage] = useState(0);
  const [cueSearch, setCueSearch] = useState('');
  const [showOnlySelectedCues, setShowOnlySelectedCues] = useState(false);
  const [showCueReviewAlertsOnly, setShowCueReviewAlertsOnly] = useState(false);
  const [happyScribeItems, setHappyScribeItems] = useState<HappyScribeLibraryItem[]>([]);
  const [happyScribeFilterEpoch, setHappyScribeFilterEpoch] = useState(0);
  const happyScribeOrigins = useRef(new Map<string,number>());
  const [happyScribeSelectedId, setHappyScribeSelectedId] = useState('');
  const [happyScribeLoading, setHappyScribeLoading] = useState(false);
  const [happyScribePage, setHappyScribePage] = useState(0);
  const [happyScribeHasMore, setHappyScribeHasMore] = useState(false);
  const [happyScribeConfigUnavailable, setHappyScribeConfigUnavailable] = useState(false);
  const [happyScribeImporting, setHappyScribeImporting] = useState(false);
  const [happyScribeMediaImporting, setHappyScribeMediaImporting] = useState(false);
  const [happyScribeMediaEnabled, setHappyScribeMediaEnabled] = useState(false);
  const happyScribeSelection = happyScribeItems.find(item => item.id === happyScribeSelectedId);

  const CUES_PER_PAGE = 60;
  const {
    history, lastStructuralEdit, nextStructuralEdit, clearEditorialHistory, rememberEdit,
    rememberGroupedEdit, endEditGroup, stepHistory, forgetServerSuggestions,
  } = useStudioEditorialHistory(excludedTurns, confirmedTurns);
  // Source identity prevents a delayed decode from updating a replacement MP3.
  const activeAudioFile = useRef<File | null>(null);
  const subtitleImportRevision = useRef(0);
  const draftOperationRevision = useRef(0);
  const savingDraft = useRef(false);
  const silenceRevision = useRef(0);
  const silenceAbort = useRef<AbortController | null>(null);
  const exportRevision = useRef(0);
  const exportAbort = useRef<AbortController | null>(null);
  const happyScribeMediaAbort = useRef<AbortController | null>(null);
  const happyScribeTranscriptAbort = useRef<AbortController | null>(null);
  const happyScribeListAbort = useRef<AbortController | null>(null);
  // Keep an up-to-date snapshot for transfers that may resolve after edits.
  // A preflight approval only covers the source and work that existed then.
  // A restored empty JSON or a deletion can leave no visible cuts while the
  // previous edits still exist in the undo or redo history. Protect that
  // recoverable work before switching audio, navigating away or transferring
  // a HappyScribe source.
  const audioReplacementEdits = useRef({
    segments, reviewCues, suggestedClips, captionTexts, history, excludedTurns,
  });
  audioReplacementEdits.current = {
    segments, reviewCues, suggestedClips, captionTexts, history, excludedTurns,
  };
  const replacementPrompt = 'Cambiar la grabación eliminará las intervenciones y sugerencias actuales, incluidas las ediciones recuperables con «Deshacer». Guarda antes tu proyecto si deseas conservarlas. ¿Continuar?';
  const hasReplacementWork = (edits: typeof audioReplacementEdits.current) =>
    edits.segments.length > 0 || edits.excludedTurns.length > 0 || edits.reviewCues.length > 0 ||
    edits.suggestedClips.length > 0 || Object.keys(edits.captionTexts).length > 0 ||
    [...edits.history.past, ...edits.history.future].some(hasRecoverableUndo);
  const sameEditorEdits = (snapshot: typeof audioReplacementEdits.current) => {
    const live = audioReplacementEdits.current;
    return live.segments === snapshot.segments && live.reviewCues === snapshot.reviewCues &&
      live.suggestedClips === snapshot.suggestedClips &&
      live.captionTexts === snapshot.captionTexts &&
      live.history === snapshot.history && live.excludedTurns === snapshot.excludedTurns;
  };
  // The JSON project omits the original audio and private transcript context.
  // Guard the in-memory editor even after an export: leaving can discard
  // pending cue selections and editorial context not present in the download.
  const hasActiveEditorWork = hasReplacementWork(audioReplacementEdits.current) ||
    Object.keys(captionTexts).length > 0;
  // Neither private transcript references, pending SRT choices, nor
  // unapplied silence suggestions are part of the portable JSON schema.
  const hasUnstoredDraftContext = reviewCues.length > 0 ||
    suggestedClips.length > 0 || Object.keys(captionTexts).length > 0 ||
    [...history.past, ...history.future].some(hasRecoverableUndo) || excludedTurns.length > 0;
  const leaveEditorPrompt = 'Salir de Audio Studio descartará los cortes y las selecciones de esta pestaña. Comprueba que guardaste tu proyecto y conservas el audio original. ¿Continuar?';
  useEffect(() => {
    if (!hasActiveEditorWork) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [hasActiveEditorWork]);
  const confirmEditorNavigation = () =>
    !hasActiveEditorWork || window.confirm(leaveEditorPrompt);
  const [segmentSearch, setSegmentSearch] = useState('');
  const [showPendingReview, setShowPendingReview] = useState(false);
  const [compactPreference, setCompactPreference] = useState<boolean | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [advancedTurnId, setAdvancedTurnId] = useState<string | null>(null);
  const [immersiveMode, setImmersiveMode] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState<'edit' | 'finish'>('edit');
  const workspaceContent = useRef<HTMLDivElement>(null);
  const workspaceExit = useRef<HTMLButtonElement>(null);
  const workspaceEnter = useRef<HTMLButtonElement>(null);
  const wasWorkspaceActive = useRef(false);
  const preferenceEdits = useRef({ exclude: false, compact: false, protocolLanguage: false });
  useEffect(() => {
    let active = true;
    void readAudioStudioEditorPreferences().then(settings => {
      // Never change parsing/export defaults after a recording was selected.
      if (!active || activeAudioFile.current) return;
      if (!preferenceEdits.current.exclude)
        setExcludeInterpreter(settings.excludeInterpreterByDefault);
      if (!preferenceEdits.current.compact)
        setCompactPreference(settings.compactViewDefault === 'auto'
          ? null : settings.compactViewDefault === 'compact');
      if (!preferenceEdits.current.protocolLanguage)
        setProtocolLanguage(settings.protocolLanguageDefault);
    }).catch(() => {
      // Preserve the local, low-cost defaults if settings are unavailable.
    });
    return () => { active = false; };
  }, []);
  const [expandedSegmentId, setExpandedSegmentId] = useState<string | null>(null);
  const [invalidExportTurn, setInvalidExportTurn] = useState<{ id: string; attempt: number } | null>(null);
  const exportFocusAttempt = useRef(0);
  const [reviewFocusRequest, setReviewFocusRequest] = useState<{ id: string; attempt: number } | null>(null);
  const reviewFocusAttempt = useRef(0);
  // Focus the first invalid clip after filters have been cleared and the row
  // has been rendered again. No media file is read or uploaded by this action.
  useEffect(() => {
    if (!invalidExportTurn) return;
    focusStudioIntervention(invalidExportTurn.id, !focusMode);
  }, [invalidExportTurn]);
  // Navigating the review queue changes only focus and the open editor.
  // It never seeks, plays, uploads, or alters intervention content.
  useEffect(() => {
    if (!reviewFocusRequest) return;
    focusStudioIntervention(reviewFocusRequest.id, !focusMode);
  }, [reviewFocusRequest]);
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

  const markAtPlayhead = (id: string, boundary: 'start' | 'end') => {
    const position = player.current?.currentTime;
    if (position === undefined || !Number.isFinite(position) || !duration) return;
    const timestamp = Math.min(duration, Math.max(0, Number(position.toFixed(2))));
    update(id, { [boundary]: timestamp });
  };

  const previewSegment = (segment: Segment) => {
    if (segment.ranges) { previewPairWithoutGap(segment.id); return; }
    previewSimpleSegment(segment);
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
    if (!first?.ranges && second && !visibleSegments.some(({ segment }) => segment.id === second.id)) {
      reportTurnAction(id, 'El siguiente corte está oculto: limpia los filtros para escucharlo.', true);
      return;
    }
    startPairPreview(id, plan, () => {
      reportTurnAction(id, first?.ranges
        ? `Preescucha de intervención compuesta: ${formatTime(plan.selectedSeconds)} de audio sin la pausa de ${formatTime(plan.skippedSeconds)}.`
        : `Preescucha local: se saltan ${formatTime(plan.skippedSeconds)} entre los dos cortes. No se modifica el proyecto.`);
    }, () => reportTurnAction(id, 'El navegador no pudo iniciar la preescucha sin pausa.', true));
  };

  const applyEditorialHistory = (direction: 'undo' | 'redo') => {
    const snapshot = direction === 'undo' ? lastStructuralEdit : nextStructuralEdit;
    if (!snapshot || busy || draftBusy || analyzingSilences || happyScribeImporting || happyScribeMediaImporting) return;
    const current: EditorialSnapshot = {
      kind: snapshot.kind, segments, captions: captionTexts, expandedId: expandedSegmentId,
      excluded: excludedTurns, confirmations: confirmedTurns,
      ...(snapshot.previousSuggestions && serverConsent ? { previousSuggestions: { silences: detectedSilences, clips: suggestedClips, omittedCount: omittedSuggestions } } : {}),
      ...(snapshot.previousReview ? { previousReview: { cues: reviewCues, selected: chosenCueIndices, page: cuePage, search: cueSearch,
        selectedOnly: showOnlySelectedCues, alertsOnly: showCueReviewAlertsOnly, segmentSearch, pendingOnly: showPendingReview } } : {}),
    };
    stepHistory(current, direction);
    stopPreview();
    stopPairPreview();
    subtitleImportRevision.current += 1;
    setSegments(snapshot.segments);
    const restoredIds = new Set(snapshot.segments.map(turn => turn.id));
    setExcludedTurns(snapshot.excluded ?? excludedTurns.filter(entry => !restoredIds.has(entry.turn.id)));
    if (snapshot.confirmations) setConfirmedTurns(snapshot.confirmations);
    if (snapshot.segments.length > ROLEPLAY_MAX_SCENARIOS) setExpandedEditor(true);
    setAdvancedTurnId(null);
    setAssignmentPackage(null);
    setCaptionTexts(snapshot.captions);
    setExpandedSegmentId(snapshot.expandedId);
    // Revoking consent clears server-derived pause metadata; undo must not
    // silently restore those suggestions after the administrator opted out.
    if (snapshot.previousSuggestions && serverConsent) {
      setDetectedSilences(snapshot.previousSuggestions.silences);
      setSuggestedClips(snapshot.previousSuggestions.clips);
      setOmittedSuggestions(snapshot.previousSuggestions.omittedCount);
    }
    if (snapshot.previousReview) {
      const review = snapshot.previousReview;
      setReviewCues(review.cues);
      setChosenCueIndices(review.selected);
      setCuePage(review.page);
      setCueSearch(review.search);
      setShowOnlySelectedCues(review.selectedOnly);
      setShowCueReviewAlertsOnly(review.alertsOnly);
      setSegmentSearch(review.segmentSearch);
      setShowPendingReview(review.pendingOnly);
    }
    setNotice(direction === 'redo' ? `Rehecha: ${snapshot.kind}. Revisa los cortes antes de exportar.` : snapshot.kind === 'idiomas'
      ? 'Asignación masiva de idiomas deshecha. Revisa los idiomas pendientes.'
      : snapshot.kind === 'hablantes'
        ? 'Asignación masiva de hablantes deshecha. Revisa los perfiles pendientes.'
      : snapshot.kind === 'eliminación'
        ? 'Intervención recuperada con sus ajustes y referencia privada de transcripción.'
        : snapshot.kind === 'adición VAD'
          ? 'Cortes VAD retirados. Las intervenciones y referencias anteriores se conservaron.'
        : snapshot.kind === 'adición manual'
          ? 'Último fragmento añadido deshecho. Se recuperaron los cortes y referencias anteriores.'
        : snapshot.kind === 'importación de subtítulos'
          ? 'Importación de subtítulos deshecha. Se restauraron las intervenciones, referencias privadas y sugerencias anteriores.'
        : snapshot.kind === 'aplicación de pausas'
          ? 'Cortes sugeridos deshechos. Recuperaste las intervenciones, referencias y selección de subtítulos anteriores.'
        : snapshot.kind === 'apertura de proyecto'
          ? 'Apertura del proyecto deshecha. Se restauraron las intervenciones, referencias privadas y revisión anteriores.'
        : `Deshecha la última ${snapshot.kind}. Revisa los cortes antes de exportar.`);
    setError('');
    setTurnActionFeedback(null);
  };
  const undoLastStructuralEdit = () => applyEditorialHistory('undo');
  const redoLastStructuralEdit = () => applyEditorialHistory('redo');

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  useEffect(() => () => {
    silenceAbort.current?.abort();
    exportRevision.current += 1;
    exportAbort.current?.abort();
    happyScribeMediaAbort.current?.abort();
    happyScribeMediaAbort.current = null;
    happyScribeTranscriptAbort.current?.abort();
    happyScribeTranscriptAbort.current = null;
    happyScribeListAbort.current?.abort();
    happyScribeListAbort.current = null;
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

  const chooseAudio = (file: File, approved?: {
    source: File | null;
    edits: typeof audioReplacementEdits.current;
  }) => {
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
    const editsNow = audioReplacementEdits.current;
    const approvedStillValid = approved?.source === activeAudioFile.current &&
      approved?.edits.segments === editsNow.segments &&
      approved?.edits.reviewCues === editsNow.reviewCues &&
      approved?.edits.suggestedClips === editsNow.suggestedClips &&
      approved?.edits.captionTexts === editsNow.captionTexts &&
      approved?.edits.history === editsNow.history && approved?.edits.excludedTurns === editsNow.excludedTurns;
    if (activeAudioFile.current && hasReplacementWork(editsNow) &&
        !approvedStillValid && !window.confirm(replacementPrompt)) {
      return;
    }
    // Stop the upstream transfer when an operator accepts a different source.
    // Otherwise a stale HappyScribe MP3 can waste up to 250 MiB of bandwidth.
    happyScribeMediaAbort.current?.abort();
    happyScribeMediaAbort.current = null;
    setHappyScribeMediaImporting(false);
    happyScribeTranscriptAbort.current?.abort();
    happyScribeTranscriptAbort.current = null;
    setHappyScribeImporting(false);
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
    resetRecoveryForSource();
    setEditorialTopic({ topic: '', subtopic: '' });
    setSegments([]);
    setExcludedTurns([]);
    setTrashOpen(false);
    setTimelineOpen(false);
    setReviewCenterOpen(false);
    setReviewCategory('all');
    setAdvancedTurnId(null);
    setConfirmedTurns(new Map());
    setCaptionTexts({});
    setReviewCues([]);
    setChosenCueIndices([]);
    setCuePage(0);
    setCueSearch('');
    setShowOnlySelectedCues(false);
    setShowCueReviewAlertsOnly(false);
    // Filters and the expanded editor belong to the previous source.
    // Do not let a replacement recording appear to have missing interventions.
    setSegmentSearch('');
    setShowPendingReview(false);
    setExpandedSegmentId(null);
    setTurnActionFeedback(null);
    clearEditorialHistory();
    setDuration(0);
    setPlayhead(0);
    setDraftBusy(false);
    activeAudioFile.current = file;
    setAudio(file);
    setUrl(URL.createObjectURL(file));
  };

  const loadSelectedCues = (
    selected: TimedTranscriptCue[], excludedCount: number, approvedReplacement = false,
  ): boolean => {
    const prepared: Segment[] = toPublishableStudioSegments(selected).map((segment, index) => ({
      ...segment,
      id: crypto.randomUUID(),
      speakerRole: classifySpeakerRole(selected[index].speaker),
      sourceSpeakerGroup: sourceSpeakerGroup(selected[index].speaker),
      language: 'unknown',
    }));
    // Importing a valid SRT/VTT can replace all existing edited cuts. Prompt
    // only when there is actual work to lose; never silently discard it.
    if ((segments.length > 0 || suggestedClips.length > 0) && !approvedReplacement && !window.confirm(
      'Aplicar estos subtítulos reemplazará las intervenciones o los cortes sugeridos pendientes. ' +
      'Guarda las intervenciones y revisa las sugerencias antes de descartarlas. ¿Continuar?',
    )) {
      setNotice('Importación de cortes cancelada. Las intervenciones actuales se conservaron.');
      return false;
    }
    subtitleImportRevision.current += 1;
    // A pending pause analysis must not recreate the previous edit's cuts.
    silenceRevision.current += 1;
    silenceAbort.current?.abort();
    silenceAbort.current = null;
    setAnalyzingSilences(false);
    // The prior clip may still be playing in the primary media element.
    // Stop it only after accepting the replacement, not when it is declined.
    stopPreview();
    stopPairPreview();
    // One accepted SRT/VTT import is a reversible editorial operation.
    // Keep private reference text in memory only; no source audio is copied.
    rememberEdit({
      kind: 'importación de subtítulos', segments: [...segments],
      captions: { ...captionTexts }, expandedId: expandedSegmentId,
      previousSuggestions: {
        silences: [...detectedSilences],
        clips: [...suggestedClips],
        omittedCount: omittedSuggestions,
      },
      // A selected SRT review is work in progress, not disposable import UI.
      // Undo restores its exact candidates, selection and filters locally.
      previousReview: {
        cues: [...reviewCues], selected: [...chosenCueIndices],
        page: cuePage, search: cueSearch,
        selectedOnly: showOnlySelectedCues, alertsOnly: showCueReviewAlertsOnly,
        segmentSearch, pendingOnly: showPendingReview,
      },
    });
    setTurnActionFeedback(null);
    // A filter for the old cuts must not hide the newly imported ones.
    setSegmentSearch('');
    setShowPendingReview(false);
    setExpandedSegmentId(null);
    setSegments(prepared);
    setCaptionTexts(Object.fromEntries(prepared.map((segment, index) => [segment.id, selected[index].text])));
    // Suggestions belong to the previous edit, not to the newly imported cues.
    setDetectedSilences([]);
    setSuggestedClips([]);
    setOmittedSuggestions(0);
    setNotice(`${prepared.length} intervenciones cargadas. Puedes deshacer esta importación; ${excludedCount} del intérprete original omitidas. Revisa idiomas, hablantes y límites antes de exportar.`);
    return true;
  };

  const applyCueSelection = () => {
    setError('');
    try {
      const selected = selectTimedCues(reviewCues, chosenCueIndices, selectionPurpose);
      // Only dismiss the transcript review after the operator accepts the
      // replacement. A declined confirmation must preserve the selection.
      if (!loadSelectedCues(selected, 0)) return;
      if (expandedEditor) setFocusMode(true);
      setReviewCues([]);
      setChosenCueIndices([]);
      setCuePage(0);
      setCueSearch('');
      setShowOnlySelectedCues(false);
      setShowCueReviewAlertsOnly(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible aplicar la selección.');
    }
  };

  const completeFilteredCueSelection = (candidateIndices: readonly number[]) => {
    try {
      const next = fillCompatibleTimedCueSelection(
        reviewCues, chosenCueIndices, candidateIndices, selectionPurpose,
      );
      const added = next.length - chosenCueIndices.length;
      if (!added) {
        setNotice(expandedEditor ? `No se añadieron turnos: revisa filtros, solapamientos y el máximo editorial de ${editorLimit}.` : 'No se añadieron turnos: revisa filtros, solapamientos y el límite de 25 cortes o 15 minutos.');
        return;
      }
      subtitleImportRevision.current += 1;
      setChosenCueIndices(next);
      setError('');
      setNotice(`${added} turnos compatibles añadidos a la selección. Revisa idiomas, hablantes y texto antes de aplicar.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Corrige la selección antes de completarla.');
    }
  };

  const expandCueProject = () => {
    try {
      const next = fillCompatibleTimedCueSelection(reviewCues, chosenCueIndices, reviewCues.map((_, index) => index), 'editor');
      subtitleImportRevision.current += 1;
      setExpandedEditor(true);
      setChosenCueIndices(next);
      setError('');
      setNotice(`Proyecto ampliado: ${next.length} turnos compatibles seleccionados. Puedes editar hasta ${STUDIO_MAX_EDITOR_SEGMENTS}; cada roleplay publicable sigue limitado a ${ROLEPLAY_MAX_SCENARIOS}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Corrige la selección antes de ampliarla.');
    }
  };

  const restoreBalancedCueSuggestion = () => {
    if (!reviewCues.length) return;
    const proposed = suggestRepresentativeTimedCueSelection(
      reviewCues, reviewCues.map((_, index) => index),
    );
    if (!proposed.length) {
      setError('No se encontraron turnos compatibles para recomendar. Selecciona los cortes manualmente.');
      return;
    }
    if (chosenCueIndices.length > 0 && !window.confirm(
      'Se reemplazará solo la selección SRT pendiente por una nueva propuesta equilibrada. ' +
      'Tus intervenciones aplicadas al editor no se modificarán. ¿Continuar?',
    )) {
      setNotice('La selección SRT actual se conservó sin cambios.');
      return;
    }
    subtitleImportRevision.current += 1;
    setChosenCueIndices(proposed);
    setCuePage(0);
    setCueSearch('');
    setShowOnlySelectedCues(true);
    setShowCueReviewAlertsOnly(false);
    setError('');
    setNotice(`Se recomendaron ${proposed.length} turnos distribuidos por la grabación. Escucha y ajusta antes de aplicar; el editor no se modificó.`);
  };

  const clearCueSelection = () => {
    if (!chosenCueIndices.length) return;
    subtitleImportRevision.current += 1;
    setChosenCueIndices([]);
    setError('');
    setNotice('Selección SRT vaciada. Las intervenciones existentes no se han modificado.');
  };

  const toggleCueSelection = (index: number) => {
    subtitleImportRevision.current += 1;
    if (chosenCueIndices.includes(index)) {
      setChosenCueIndices(prev => prev.filter(value => value !== index));
      return;
    }
    if (chosenCueIndices.length >= editorLimit) {
      setError(`Puedes seleccionar como máximo ${editorLimit} intervenciones en este proyecto.`);
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
    stopPreview();
    stopPairPreview();
    // A confirmed replacement from server-derived pauses must be just as
    // reversible as an SRT import. Keep only editorial metadata in memory.
    rememberEdit({
      kind: 'aplicación de pausas',
      segments: [...segments],
      captions: { ...captionTexts },
      expandedId: expandedSegmentId,
      previousSuggestions: {
        silences: [...detectedSilences], clips: [...suggestedClips],
        omittedCount: omittedSuggestions,
      },
      previousReview: {
        cues: [...reviewCues], selected: [...chosenCueIndices],
        page: cuePage, search: cueSearch,
        selectedOnly: showOnlySelectedCues, alertsOnly: showCueReviewAlertsOnly,
        segmentSearch, pendingOnly: showPendingReview,
      },
    });
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
    // The proposal has been consumed; keep the confirmation notice, but do
    // not leave a stale "Reemplazar" action able to overwrite later edits.
    setDetectedSilences([]);
    setSuggestedClips([]);
    setOmittedSuggestions(0);
    setError('');
    setNotice('Cortes sugeridos aplicados. Puedes deshacer esta sustitución. Son aproximaciones basadas en pausas, no separación de voces; revisa cada inicio, fin, rol e idioma antes de exportar.');
  };

  const confirmPendingSrtReviewReplacement = (
    providerDurationSeconds?: number | null, includeCurrentCuts = false,
  ) => {
    // Provider metadata is only a warning signal, not proof that two sources
    // are identical. Do not incur a remote export for an obvious mismatch
    // without asking; missing or imprecise metadata should not block work.
    const durationMismatch = typeof providerDurationSeconds === 'number' &&
      Number.isFinite(providerDurationSeconds) && providerDurationSeconds > 0 &&
      Math.abs(providerDurationSeconds - duration) > Math.max(3, duration * 0.05);
    const replacesCurrentCuts = includeCurrentCuts &&
      (segments.length > 0 || suggestedClips.length > 0);
    if (!reviewCues.length && !durationMismatch && !replacesCurrentCuts) return true;
    const warnings = [
      ...(durationMismatch
        ? [`La grabación abierta dura ${formatTime(duration)}, pero HappyScribe indica ${formatTime(providerDurationSeconds)}. Comprueba que corresponden al mismo audio antes de importar.`]
        : []),
      ...(reviewCues.length > 0
        ? ['Importar otra transcripción reemplazará los turnos SRT pendientes y su selección. Conserva el archivo de subtítulos original si necesitas esa revisión.']
        : []),
      ...(replacesCurrentCuts
        ? ['Aplicar el nuevo SRT sustituirá las intervenciones o sugerencias pendientes. Guarda tu proyecto y revisa las sugerencias si quieres conservarlas.']
        : []),
    ];
    if (window.confirm(`${warnings.join(' ')} ¿Continuar?`)) return true;
    setNotice(durationMismatch
      ? 'Importación cancelada: comprueba la duración y el origen de la transcripción. Se conservó la edición actual.'
      : replacesCurrentCuts
        ? 'Importación cancelada. Se conservaron las intervenciones y las sugerencias existentes.'
        : 'Cambio de transcripción cancelado. Se conservaron los turnos y la selección SRT.');
    return false;
  };

  const importSubtitles = async (
    file: File,
    approval?: { revision: number; edits: typeof audioReplacementEdits.current },
  ) => {
    if (!audio || !duration) return;
    // Remote approval only covers the exact editor snapshot. Do not apply
    // fetched subtitles if any turn, suggestion or private reference changed.
    if (approval && (approval.revision !== subtitleImportRevision.current ||
        !sameEditorEdits(approval.edits))) {
      setNotice('No se aplicó la transcripción remota: la edición cambió durante la descarga.');
      return;
    }
    if (!approval && reviewCues.length > 0 && !confirmPendingSrtReviewReplacement()) return;
    const revision = ++subtitleImportRevision.current;
    setError('');
    setNotice('');
    try {
      const subtitleMaxBytes = usesLocalLongMode(audio, duration) ? 5_000_000 : 1_000_000;
      if (/\.md$/i.test(file.name)) {
        throw new Error('El .md de HappyScribe es una transcripción Markdown, no un archivo SRT/VTT. Usa «Importar transcripción» en la biblioteca de HappyScribe o exporta un SRT con tiempos. Tus cortes no se han modificado.');
      }
      if (!/\.(srt|vtt)$/i.test(file.name) || file.size < 1 || file.size > subtitleMaxBytes) {
        throw new Error('Selecciona un SRT o VTT dentro del tamaño permitido (1 MB normal, 5 MB local).');
      }
      const transcript = await file.text();
      // The file may have changed, or a newer import/edit may have started.
      if (revision !== subtitleImportRevision.current ||
          (approval && !sameEditorEdits(approval.edits))) return;
      const { cues, diagnostics } = parseTimedTranscriptForReviewWithDiagnostics(transcript, usesLocalLongMode(audio, duration));
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
      // Never silently convert repaired provider timings into a published
      // roleplay. Show them as candidate turns for explicit approval instead.
      const timingWasRepaired = diagnostics.reordered > 0 ||
        diagnostics.overlapping > 0 || diagnostics.divided > 0 || diagnostics.skipped > 0;
      let canApplyAll = !timingWasRepaired && selected.length <= ROLEPLAY_MAX_SCENARIOS;
      if (canApplyAll) {
        try { selectTimedCues(selected, allIndices); }
        catch { canApplyAll = false; }
      }
      if (canApplyAll) {
        // Confirm before changing existing cuts, cue-review state or filters.
        if (!loadSelectedCues(selected, excludedCount, Boolean(approval))) return;
        setCueSearch('');
        setShowOnlySelectedCues(false);
        setShowCueReviewAlertsOnly(false);
        setReviewCues([]);
        setChosenCueIndices([]);
        setCuePage(0);
      } else {
        setCueSearch('');
        setShowOnlySelectedCues(false);
        setShowCueReviewAlertsOnly(false);
        setCuePage(0);
        setReviewCues(selected);
        const compatible = suggestRepresentativeTimedCueSelection(selected, allIndices);
        setChosenCueIndices(compatible);
        const repairedNotice = timingWasRepaired
          ? `Correcciones de tiempos para revisión: ${diagnostics.reordered} fuera de orden, ${diagnostics.overlapping} solapamientos y ${diagnostics.divided} intervenciones largas divididas en ventanas aproximadas (sin alineación de palabras), y ${diagnostics.skipped} intervalos invertidos o inferiores a 0,1 s omitidos. `
          : '';
        setNotice(`${repairedNotice}${selected.length} intervenciones disponibles; ${excludedCount} del intérprete original omitidas. Se sugirieron ${compatible.length} turnos compatibles de distintos momentos de la grabación, sin voz etiquetada del intérprete. Escucha los cortes y confirma hablantes antes de aplicar; el borrador no se reemplazó.`);
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
    if (segments.length >= editorLimit) {
      reportTurnAction(id, `Límite de ${editorLimit} intervenciones. Elimina un turno o amplía el proyecto antes de dividir.`, true);
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
    rememberEdit({
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
    if (!visibleSegments.some(({ segment }) => segment.id === second.id)) {
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
    rememberEdit({
      kind: 'unión',
      segments: [...segments], captions: { ...captionTexts }, expandedId: expandedSegmentId,
    });
    setSegments(previous => previous.filter(item => item.id !== second.id)
      .map(item => item.id === first.id
        ? { ...item, end: second.end, scriptPrompt: mergedPrompt,
            sourceSpeakerGroup: first.sourceSpeakerGroup === second.sourceSpeakerGroup ? first.sourceSpeakerGroup : undefined,
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
    if (segments.length >= editorLimit) {
      reportTurnAction(id, `Hay ${editorLimit} intervenciones. Elimina otra o amplía el proyecto antes de separar.`, true);
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
    rememberEdit({
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
    if (!archiveTurns(segments.filter(turn => excludedIds.has(turn.id)))) return;
    // This is an undoable bulk action; no remote export or upload is involved.
    subtitleImportRevision.current += 1;
    stopPreview();
    stopPairPreview();
    rememberEdit({
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
    setNotice('Intervenciones del intérprete original excluidas. Puedes recuperarlas desde la papelera editorial.');
  };

  const setLanguageForPendingTurns = (language: 'en' | 'es', visibleIds: readonly string[]) => {
    const visible = new Set(visibleIds);
    const pendingIds = new Set(segments.filter(item =>
      visible.has(item.id) && item.language === 'unknown' &&
      item.speakerRole !== 'interpreter' &&
      (!studioEditorialProfile(item.speakerRole) || studioEditorialProfile(item.speakerRole)?.language === language),
    ).map(item => item.id));
    if (!pendingIds.size) return;
    // The choice is intentional and undoable; never infer a clip's language
    // or change labels already reviewed by an administrator.
    subtitleImportRevision.current += 1;
    stopPreview();
    stopPairPreview();
    rememberEdit({
      kind: 'idiomas', segments: [...segments],
      captions: { ...captionTexts }, expandedId: expandedSegmentId,
    });
    setSegments(previous => {
      const indexById = new Map([...previous]
        .sort((a, b) => a.start - b.start)
        .map((item, index) => [item.id, index] as const));
      return previous.map(item => {
        if (!pendingIds.has(item.id)) return item;
        return {
          ...item,
          language,
          title: titleAfterProfileChange(
            item.title, item.speakerRole, item.language,
            indexById.get(item.id) ?? 0, item.speakerRole, language,
          ),
        };
      });
    });
    setTurnActionFeedback(null);
    setError('');
    setNotice(`Idioma ${language.toUpperCase()} asignado a ${pendingIds.size} intervenciones pendientes, sin modificar idiomas ya revisados ni al intérprete original. Puedes deshacerlo; verifica cada audio antes de exportar.`);
  };

  const applyProfileLanguagePattern = (visibleIds: readonly string[]) => {
    const visible = new Set(visibleIds);
    const pending = segments.filter(item => visible.has(item.id) &&
      item.language === 'unknown' && item.speakerRole !== 'interpreter' && studioEditorialProfile(item.speakerRole) !== null);
    if (!pending.length) return;
    const ids = new Set(pending.map(item => item.id));
    subtitleImportRevision.current += 1;
    stopPreview();
    stopPairPreview();
    rememberEdit({
      kind: 'idiomas', segments: [...segments],
      captions: { ...captionTexts }, expandedId: expandedSegmentId,
    });
    setSegments(previous => {
      const order = [...previous].sort((a, b) => a.start - b.start);
      return previous.map(item => {
        const profile = studioEditorialProfile(item.speakerRole);
        if (!ids.has(item.id) || item.language !== 'unknown' || !profile || profile.role === 'interpreter') return item;
        const language = profile.language;
        return {
          ...item, language,
          title: titleAfterProfileChange(item.title, item.speakerRole, item.language,
            order.findIndex(turn => turn.id === item.id), item.speakerRole, language),
        };
      });
    });
    setTurnActionFeedback(null);
    setError('');
    setNotice(`Patrón cliente EN / hispanohablante ES aplicado a ${pending.length} turnos pendientes. Escucha y confirma los idiomas; puedes deshacer esta acción.`);
  };

  const setSpeakerForPendingTurns = (
    role: 'doctor' | 'patient', visibleIds: readonly string[],
  ) => {
    const visible = new Set(visibleIds);
    const language: StudioLanguage = role === 'doctor' ? 'en' : 'es';
    const pendingIds = new Set(segments.filter(item =>
      visible.has(item.id) && item.speakerRole === 'unknown' &&
      (item.language === 'unknown' || item.language === language),
    ).map(item => item.id));
    if (!pendingIds.size) return;
    // An administrator must explicitly choose the generic role. Never infer
    // speaker identity from audio, overwrite reviewed labels, or bulk-classify
    // the original interpreter (whose exclusion requires individual review).
    subtitleImportRevision.current += 1;
    stopPreview();
    stopPairPreview();
    rememberEdit({
      kind: 'hablantes', segments: [...segments],
      captions: { ...captionTexts }, expandedId: expandedSegmentId,
    });
    setSegments(previous => {
      const indexById = new Map([...previous]
        .sort((a, b) => a.start - b.start)
        .map((item, index) => [item.id, index] as const));
      return previous.map(item => {
        if (!pendingIds.has(item.id)) return item;
        return {
          ...item,
          speakerRole: role, language,
          title: titleAfterProfileChange(
            item.title, item.speakerRole, item.language,
            indexById.get(item.id) ?? 0, role, language,
          ),
        };
      });
    });
    setTurnActionFeedback(null);
    setError('');
    setNotice(`Perfil ${role === 'doctor' ? 'Cliente' : 'Hispanohablante'} (${language.toUpperCase()}) asignado a ${pendingIds.size} intervenciones visibles. Se conservaron los idiomas incompatibles ya revisados. Escucha cada audio; puedes deshacer esta asignación.`);
  };

  const applySourceSpeakerProfile = (id: string) => {
    const result = propagateSpeakerProfile(segments, id);
    if (!result.changed) return;
    subtitleImportRevision.current += 1;
    stopPreview();
    stopPairPreview();
    rememberEdit({
      kind: 'hablantes', segments: [...segments],
      captions: { ...captionTexts }, expandedId: expandedSegmentId,
    });
    setSegments(result.turns);
    setTurnActionFeedback(null);
    setError('');
    setNotice(`Perfil aplicado a ${result.changed} intervenciones de la misma etiqueta de origen. Se conservaron los perfiles e idiomas ya revisados. Escucha las voces; puedes deshacer la asignación.`);
  };

  const addSegment = () => {
    if (segments.length >= editorLimit) {
      setError(`Se alcanzó el límite de ${editorLimit} intervenciones del editor.`);
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
    // Creating a cut manually should be as reversible as adding a VAD batch.
    // Preserve the previous private editor metadata, never the source media.
    rememberEdit({
      kind: 'adición manual',
      segments: [...segments], captions: { ...captionTexts }, expandedId: expandedSegmentId,
    });
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
    setNotice('Intervención creada cerca del cursor sin solaparse con otros turnos. Puedes deshacerla; revisa hablante, idioma y límites.');
  };

  const update = (id: string, patch: Partial<Segment>) => {
    if (segments.some(segment => segment.id === id && segment.ranges) &&
        (patch.start !== undefined || patch.end !== undefined)) {
      reportTurnAction(id, 'Separa los dos cortes antes de modificar sus límites.', true);
      return;
    }
    const current = segments.find(segment => segment.id === id);
    if (!current || Object.entries(patch).every(([key,value]) => current[key as keyof Segment] === value)) return;
    const groupKey = id + ':' + Object.keys(patch).sort().join(',');
    rememberGroupedEdit(groupKey, { kind: 'edición de intervención', segments, captions: captionTexts, expandedId: expandedSegmentId });
    if (previewingId?.startsWith('boundary-proposal:')) stopPreview();
    stopPairPreview();
    setTurnActionFeedback(null);
    subtitleImportRevision.current += 1;
    setSegments(prev => {
      const order = [...prev].sort((a, b) => a.start - b.start);
      const index = order.findIndex(segment => segment.id === id);
      return prev.map(segment => {
        if (segment.id !== id) return segment;
        const next = { ...segment, ...patch };
        // A changed cut may include other voices; discard the source grouping.
        if ((patch.start !== undefined && patch.start !== segment.start) ||
            (patch.end !== undefined && patch.end !== segment.end)) next.sourceSpeakerGroup = undefined;
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

  const saveDraft = useCallback(async (part?: StudioPublicationPart<Segment>) => {
    // Keyboard and button activations can occur before React updates draftBusy.
    // Only one local download may be hashing the same source at a time.
    if (!audio || !duration || busy || draftBusy || savingDraft.current) return;
    if (!segments.length && (reviewCues.length > 0 || suggestedClips.length > 0)) {
      // An empty JSON cannot restore uncommitted SRT selections or proposed
      // cuts. Do not present such a download as a successful backup.
      setError('Todavía no hay cortes aplicados para guardar. Aplica los turnos SRT o las sugerencias antes de descargar el JSON; conserva también el archivo de subtítulos original.');
      setNotice('');
      return;
    }
    savingDraft.current = true;
    const revision = subtitleImportRevision.current;
    const operation = ++draftOperationRevision.current;
    // Persist in timeline order even if a new gap was filled after later clips.
    const snapshot = [...(part?.turns ?? segments)].sort((a, b) => a.start - b.start);
    setDraftBusy(true);
    setError('');
    setNotice('');
    try {
      const localOnly = Boolean(part) || usesLocalLongMode(audio, duration) ||
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
      link.download = part ? `roleplay-studio-parte-${part.number}.json` : localOnly
        ? 'roleplay-studio-proyecto-largo.json' : 'roleplay-studio-proyecto.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 30000);
      setNotice((part
        ? `Parte ${part.number} descargada (${snapshot.length} intervenciones). Genera su ZIP con la grabación original en el exportador local. El proyecto maestro sigue intacto.`
        : snapshot.length > ROLEPLAY_MAX_SCENARIOS
        ? 'Borrador editorial ampliado v3 guardado. Vuelve a abrirlo en Audio Studio; no es compatible con el exportador de paquetes actual hasta reducirlo al límite publicable.'
        : localOnly
        ? 'Plan de cortes local descargado. Próximo paso: abre el JSON y la grabación original en el exportador local actualizado para generar el ZIP, y luego impórtalo en Crear roleplay. El JSON no contiene audio ni transcripción; la huella de la fuente es parcial.'
        : 'Proyecto guardado localmente. Conserva también el MP3 original; el JSON no contiene audio ni transcripción.') +
        (hasUnstoredDraftContext
          ? ' Atención: el JSON no guarda referencias privadas de transcripción, turnos SRT sin aplicar, sugerencias sin confirmar ni la papelera editorial. Conserva los SRT/VTT originales para volver a importarlos.'
          : ''));
    } catch (cause) {
      if (revision === subtitleImportRevision.current) {
        setError(cause instanceof Error ? cause.message : 'No fue posible guardar el proyecto.');
      }
    } finally {
      savingDraft.current = false;
      if (operation === draftOperationRevision.current) setDraftBusy(false);
    }
  }, [audio, duration, busy, draftBusy, segments, allowServerZipExport,
    reviewCues.length, suggestedClips.length, hasUnstoredDraftContext]);

  // Ctrl+S / Cmd+S saves the existing local JSON draft instead of asking the
  // browser to save the entire webpage. No API, storage or audio upload.
  useEffect(() => {
    if (!audio || duration <= 0 || !hasActiveEditorWork) return;
    const onSaveShortcut = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 's' || (!event.ctrlKey && !event.metaKey) ||
          event.altKey || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      if (!event.repeat) void saveDraft();
    };
    window.addEventListener('keydown', onSaveShortcut);
    return () => window.removeEventListener('keydown', onSaveShortcut);
  }, [audio, duration, hasActiveEditorWork, saveDraft]);

  const openDraftFile = async (file: File) => {
    if (!audio || !duration || busy || draftBusy) return;
    const revision = ++subtitleImportRevision.current;
    const operation = ++draftOperationRevision.current;
    setDraftBusy(true);
    setError('');
    setNotice('');
    try {
      if (/\.md$/i.test(file.name)) {
        throw new Error('El .md de HappyScribe no es un proyecto JSON de Audio Studio. Importa primero la transcripción como SRT desde HappyScribe, revisa los cortes y usa «Guardar proyecto JSON». Tus intervenciones actuales se conservaron.');
      }
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
      silenceRevision.current += 1;
      silenceAbort.current?.abort();
      silenceAbort.current = null;
      setAnalyzingSilences(false);
      const containsCompound = restored.some(segment => segment.ranges !== undefined);
      // Opening a v2 project must be local-only even after the user separates
      // its cuts. For ordinary v1 projects retain the user's chosen mode.
      if (containsCompound) setAllowServerZipExport(false);
      stopPreview();
      stopPairPreview();
      // Confirmed, source-verified JSON recovery can still be mistaken.
      // Make it a single reversible local edit without embedding audio in undo.
      rememberEdit({
        kind: 'apertura de proyecto',
        segments: [...segments], captions: { ...captionTexts }, expandedId: expandedSegmentId,
        previousSuggestions: {
          silences: [...detectedSilences], clips: [...suggestedClips],
          omittedCount: omittedSuggestions,
        },
        previousReview: {
          cues: [...reviewCues], selected: [...chosenCueIndices],
          page: cuePage, search: cueSearch,
          selectedOnly: showOnlySelectedCues, alertsOnly: showCueReviewAlertsOnly,
          segmentSearch, pendingOnly: showPendingReview,
        },
      });
      if (restored.length > ROLEPLAY_MAX_SCENARIOS) {
        setExpandedEditor(true);
        setFocusMode(true);
      }
      setSegments(restored.map(segment => ({ ...segment, id: crypto.randomUUID() })));
      setCaptionTexts({});
      setReviewCues([]);
      setChosenCueIndices([]);
      setDetectedSilences([]);
      setSuggestedClips([]);
      setOmittedSuggestions(0);
      // A previous project's filters can otherwise make a valid restored
      // project appear empty or leave the old turn expanded.
      setSegmentSearch('');
      setShowPendingReview(false);
      setExpandedSegmentId(null);
      setTurnActionFeedback(null);
      setNotice(restored.length > ROLEPLAY_MAX_SCENARIOS
        ? `Borrador editorial ampliado v3 restaurado: ${restored.length} intervenciones. La publicación sigue limitada a ${ROLEPLAY_MAX_SCENARIOS}.`
        : containsCompound
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

  const enableLocalMp3 = async () => {
    if (!audio || !localMp3Eligible || busy || draftBusy || analyzingSilences || exportAbort.current) return;
    const source = audio;
    const operation = ++exportRevision.current;
    const controller = new AbortController();
    exportAbort.current = controller;
    setBusy(true);
    setError('');
    setNotice('Preparando conversión local MP3 a WAV de 24 kHz. Si se están calculando las ondas, espera a que termine esa decodificación.');
    setAssignmentPackage(null);
    try {
      const wav = await decodeLocalMp3ForAssignment(source, duration, controller.signal);
      if (operation !== exportRevision.current || controller.signal.aborted) return;
      setConvertedMp3({ original: source, wav });
      setNotice('Audio local listo. Escucha y revisa los cortes antes de asignar.');
    } catch (cause) {
      if (operation === exportRevision.current && !controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'No se pudo convertir el MP3 local.');
    } finally {
      if (operation === exportRevision.current) {
        exportAbort.current = null;
        setBusy(false);
      }
    }
  };

  const releaseLocalMp3 = () => {
    if (!convertedMp3 || busy || draftBusy || analyzingSilences || exportAbort.current) return;
    setConvertedMp3(null);
    setWavPlan(null);
    setAssignmentPackage(null);
    setPublicationPartKey('');
    setNotice('Copia WAV temporal liberada. Se conservan la grabación original y todas las intervenciones.');
    setError('');
  };

  const prepareLocalAssignment = async (part?: StudioPublicationPart<Segment>) => {
    if (!audio || !duration || busy || draftBusy || analyzingSilences || exportAbort.current) return;
    const selected = part?.turns ?? segments;
    if (!localWavSource || !currentWavPlan || currentWavPlan.issue || (part ? !currentWavPlan.parts.some(item => item.key === part.key) : currentWavPlan.parts.length !== 1)) return;
    setAssignmentPackage(null);
    setError('');
    setNotice('');
    const operation = ++exportRevision.current;
    const editorRevision = subtitleImportRevision.current;
    const controller = new AbortController();
    exportAbort.current = controller;
    const current = () => operation === exportRevision.current &&
      editorRevision === subtitleImportRevision.current && !controller.signal.aborted;
    setBusy(true);
    try {
      const files = await prepareLocalWavAssignment(localWavSource, selected, controller.signal,
        (done,total) => { if (current()) setNotice(`Preparando audio local: ${done}/${total}.`); });
      if (!current()) return;
      setAssignmentPackage({ token: crypto.randomUUID(), files, revision: editorRevision, source: audio,
        cuts: segments, partKey: part?.key });
      setNotice('Cortes WAV listos. El original no se ha enviado al servidor. Guarda el proyecto antes de continuar a asignación.');
    } catch (cause) {
      if (current()) setError(cause instanceof Error ? cause.message : 'No se pudo preparar el audio local.');
    } finally {
      if (operation === exportRevision.current) {
        exportAbort.current = null;
        setBusy(false);
      }
    }
  };

  const exportPackage = async (part?: StudioPublicationPart<Segment>, purpose: 'download' | 'assignment' = 'download') => {
    if (!audio || !duration || !segments.length || busy || draftBusy || exportAbort.current) return;
    setError('');
    setNotice('');
    setTurnActionFeedback(null);
    if (purpose === 'assignment') setAssignmentPackage(null);
    const masterOrder = [...segments].sort((a, b) => a.start - b.start);
    const ordered = part ? part.turns : masterOrder;
    const revealInvalidTurn = (segment: Segment, index: number, reason: string) => {
      // Export is blocked before saving or uploading anything. Surface the
      // exact turn, even if a search or pending-only filter was hiding it.
      setSegmentSearch('');
      setShowPendingReview(false);
      setExpandedSegmentId(segment.id);
      setWorkspaceTab('edit');
      setAdvancedTurnId(segment.id);
      setInvalidExportTurn({ id: segment.id, attempt: ++exportFocusAttempt.current });
      setTurnActionFeedback({ id: segment.id, message: reason, error: true });
      setError(`Intervención ${part ? masterOrder.findIndex(item => item.id === segment.id) + 1 : index + 1}: ${reason}`);
    };
    if (ordered.length > ROLEPLAY_MAX_SCENARIOS) {
      setError(`El proyecto tiene ${ordered.length} intervenciones. La exportación admite ${ROLEPLAY_MAX_SCENARIOS} por roleplay. Guarda el proyecto ampliado antes de preparar una selección más pequeña.`);
      return;
    }
    // The original interpreter is never exportable: surface this safety
    // requirement before any other editorial validation, as before.
    const interpreterIndex = ordered.findIndex(item => item.speakerRole === 'interpreter');
    if (interpreterIndex !== -1) {
      revealInvalidTurn(ordered[interpreterIndex], interpreterIndex,
        'elimina el fragmento del intérprete original antes de exportar el roleplay.');
      return;
    }
    let end = 0;
    let total = 0;
    for (const [index, segment] of ordered.entries()) {
      const ranges = validStudioRanges(segment, duration);
      const issue = !segment.title.trim()
        ? 'añade un título antes de exportar.'
        : segment.title.length > 200
          ? 'reduce el título a 200 caracteres o menos.'
          : !ranges
            ? 'corrige los límites de corte (máximo 5 minutos de audio seleccionado).'
            : segment.start < end
              ? 'este corte se solapa con la intervención anterior.'
              : segment.scriptPrompt.length > 5000
                ? 'reduce las instrucciones a 5000 caracteres o menos.'
                : !Number.isInteger(segment.responseLimit) || segment.responseLimit < 0 ||
                    segment.responseLimit > ROLEPLAY_RESPONSE_MAX_DURATION_SEC
                  ? `ajusta el tiempo de respuesta entre 0 y ${ROLEPLAY_RESPONSE_MAX_DURATION_SEC} segundos.`
                  : null;
      if (issue) {
        revealInvalidTurn(segment, index, issue);
        return;
      }
      // An invalid range always produces an issue above, before this point.
      if (!ranges) return;
      end = segment.end;
      total += studioSelectedSeconds(ranges);
      if (total > STUDIO_PACKAGE_AUDIO_SECONDS) {
        revealInvalidTurn(segment, index,
          'la selección acumulada supera 15 minutos. Reduce este corte o alguno de los anteriores antes de exportar.');
        return;
      }
    }
    // Long recordings create only a local JSON draft. Do not allocate a
    // remote ZIP AbortController for this branch: otherwise the early return
    // locks all subsequent downloads until an edit resets exportAbort.
    if (part || usesLocalLongMode(audio, duration) ||
        ordered.some(segment => segment.ranges !== undefined) ||
        !allowServerZipExport) {
      if (purpose === 'assignment') {
        setError('La preparación directa requiere una grabación MP3 compatible, cortes simples y autorización del procesamiento en el servidor. Usa el plan local para otros proyectos.');
        return;
      }
      await saveDraft(part);
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
      form.append('segments', JSON.stringify(ordered.map((segment, index) => ({
        title: segment.title, start: segment.start, end: segment.end,
        scriptPrompt: segment.scriptPrompt, responseLimit: segment.responseLimit,
        studioTurn: index + 1, ...(segment.language === 'en' || segment.language === 'es' ? { studioLanguage: segment.language } : {}),
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
      if (purpose === 'assignment') {
        if (blob.size < 22 || blob.size > STUDIO_HANDOFF_MAX_BYTES) throw new Error('El paquete supera el límite de importación temporal. Usa la exportación habitual.');
        const file = new File([blob], 'roleplay-studio.zip', { type: 'application/zip' });
        setAssignmentPackage({ token: crypto.randomUUID(), file, revision: editorRevision, source: audio, cuts: segments });
        setNotice('Paquete listo para asignar. Continúa al formulario de creación; no se ha publicado ninguna sesión.');
        return;
      }
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

  const loadHappyScribeItems = async (page = 0, refreshId?: string) => {
    // Page 0 is a manual refresh. Other pages load only on explicit request.
    // The ref closes the rapid-click race before React rerenders disabled buttons.
    if (happyScribeListAbort.current || happyScribeTranscriptAbort.current || happyScribeMediaAbort.current) return;
    if (refreshId ? happyScribeOrigins.current.get(refreshId) !== page :
      (page !== 0 && (!happyScribeHasMore || page !== happyScribePage + 1 || page > 1000))) return;
    const controller = new AbortController();
    happyScribeListAbort.current = controller;
    setHappyScribeLoading(true);
    setError('');
    setHappyScribeConfigUnavailable(false);
    try {
      const response = await fetch(`/api/admin/happyscribe/transcriptions?page=${page}`, {
        credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      });
      const body = await response.json().catch(() => null);
      if (controller.signal.aborted || happyScribeListAbort.current !== controller) return;
      if (!response.ok || !body?.success || !Array.isArray(body.data)) {
        // Provider rate limits also return 503. Only an explicit server-side
        // configuration code should display the recovery instructions.
        if (response.status === 503 && body?.code === 'HAPPYSCRIBE_CONFIGURATION_UNAVAILABLE') {
          setHappyScribeConfigUnavailable(true);
          // A disabled/unreadable provider configuration invalidates the
          // prior catalog selection and import proofs in this browser view.
          happyScribeOrigins.current.clear();
          setHappyScribeFilterEpoch(previous => previous + 1);
          setHappyScribeItems([]);
          setHappyScribeSelectedId('');
          setHappyScribeHasMore(false);
          setHappyScribeMediaEnabled(false);
        }
        throw new Error(typeof body?.error === 'string' ? body.error : 'No fue posible consultar HappyScribe.');
      }
      const items = body.data as typeof happyScribeItems;
      setHappyScribeMediaEnabled(body.mediaImportEnabled === true);
      if (refreshId) {
        const refreshed = items.find(item => item.id === refreshId);
        if (!refreshed) {
          // The provider's catalog order may have changed. Never substitute
          // a different item or leave an old authorization ready for import.
          happyScribeOrigins.current.delete(refreshId);
          setHappyScribeItems(current => current.filter(item => item.id !== refreshId));
          setHappyScribeSelectedId(current => current === refreshId ? '' : current);
          setError('La selección ya no aparece en su página original. Actualiza la biblioteca y localízala nuevamente.');
          return;
        }
        setHappyScribeItems(current => current.map(item => item.id === refreshId ? refreshed : item));
        if (!happyScribeReady(refreshed)) setHappyScribeSelectedId(current => current === refreshId ? '' : current);
        setNotice('Selección de HappyScribe renovada. No se ha descargado ningún archivo.');
        return;
      }
      if (page === 0) {
        happyScribeOrigins.current.clear();
        setHappyScribeFilterEpoch(previous => previous + 1);
        for (const item of items) happyScribeOrigins.current.set(item.id, page);
        setHappyScribeItems(items);
        setHappyScribeSelectedId(current =>
          items.some(item => item.id === current) ? current : items.find(item =>
            ['automatic_done', 'done'].includes(item.state))?.id ?? '',
        );
      } else {
        // Provider pages may overlap. Keep the first occurrence and selection.
        for (const item of items) if (!happyScribeOrigins.current.has(item.id)) happyScribeOrigins.current.set(item.id, page);
        setHappyScribeItems(current => {
          const seen = new Set(current.map(item => item.id));
          const newItems = items.filter(item => {
            if (seen.has(item.id)) return false;
            seen.add(item.id);
            return true;
          });
          return [...current, ...newItems];
        });
        setHappyScribeSelectedId(current => current || (items.find(item =>
          ['automatic_done', 'done'].includes(item.state))?.id ?? ''));
      }
      setHappyScribePage(page);
      setHappyScribeHasMore(body.hasMore === true && page < 1000);
      setNotice(`HappyScribe: página ${page + 1} consultada. No se ha descargado ningún archivo.`);
    } catch (cause) {
      if (!controller.signal.aborted && happyScribeListAbort.current === controller) {
        setError(cause instanceof Error ? cause.message : 'No fue posible consultar HappyScribe.');
      }
    } finally {
      if (happyScribeListAbort.current === controller) {
        happyScribeListAbort.current = null;
        setHappyScribeLoading(false);
      }
    }
  };

  const importHappyScribeTranscript = async () => {
    if (!audio || !duration) {
      setError('Carga primero en Audio Studio el audio original correspondiente a esta transcripción.');
      return;
    }
    // State-based disabled controls render later. The ref closes the window
    // between a first click and that render, avoiding duplicate provider exports.
    if (!happyScribeSelectedId || happyScribeImporting || happyScribeTranscriptAbort.current) return;
    const item = happyScribeItems.find(entry => entry.id === happyScribeSelectedId);
    if (!item || !['automatic_done', 'done'].includes(item.state)) {
      setError('Selecciona una transcripción completada en HappyScribe.');
      return;
    }
    const expiry = happyScribeProofExpiry(item.importProof);
    if (expiry !== null && expiry <= Date.now()) { setError('La autorización de esta transcripción caducó. Pulsa «Renovar selección» antes de importar.'); return; }
    // Ask before a remote SRT export consumes provider bandwidth. Cancelled
    // edits remain untouched and no POST is sent to the frontend VPS.
    if (!confirmPendingSrtReviewReplacement(item.durationSeconds, true)) return;
    // Discard provider exports that finish after an audio replacement or edit.
    const approvedEdits = audioReplacementEdits.current;
    const sourceAtRequest = audio;
    const revisionAtRequest = subtitleImportRevision.current;
    const controller = new AbortController();
    happyScribeTranscriptAbort.current = controller;
    setHappyScribeImporting(true);
    setError('');
    try {
      const response = await fetch('/api/admin/happyscribe/transcriptions', {
        method: 'POST', credentials: 'same-origin', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, proof: item.importProof }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.success || typeof body.data?.content !== 'string') {
        throw new Error(typeof body?.error === 'string' ? body.error : 'No fue posible importar el SRT.');
      }
      if (controller.signal.aborted || activeAudioFile.current !== sourceAtRequest) return;
      if (revisionAtRequest !== subtitleImportRevision.current) {
        // A filter, cue selection or other local edit supersedes this export.
        // Explain the discarded response without overwriting the newer work.
        setNotice('La transcripción remota no se aplicó porque la edición cambió durante la descarga.');
        return;
      }
      if (!sameEditorEdits(approvedEdits)) {
        setNotice('No se aplicó la transcripción remota: la edición cambió durante la descarga.');
        return;
      }
      const file = new File([body.data.content], happyScribeImportFilename(item.name, 'srt'), {
        type: 'application/x-subrip',
      });
      await importSubtitles(file, { revision: revisionAtRequest, edits: approvedEdits });
    } catch (cause) {
      if (!controller.signal.aborted && revisionAtRequest === subtitleImportRevision.current &&
          activeAudioFile.current === sourceAtRequest) {
        setError(cause instanceof Error ? cause.message : 'No fue posible importar desde HappyScribe.');
      }
    } finally {
      if (happyScribeTranscriptAbort.current === controller) {
        happyScribeTranscriptAbort.current = null;
        setHappyScribeImporting(false);
      }
    }
  };

  const importHappyScribeAudio = async () => {
    // Prevent a second potentially expensive MP3 export before React rerenders.
    if (!happyScribeSelectedId || happyScribeMediaImporting || happyScribeMediaAbort.current) return;
    const item = happyScribeItems.find(entry => entry.id === happyScribeSelectedId);
    if (!item || item.state !== 'automatic_done') {
      setError('El audio original solo está disponible para transcripciones completadas con el estado automatic_done.');
      return;
    }
    const expiry = happyScribeProofExpiry(item.importProof);
    if (expiry !== null && expiry <= Date.now()) { setError('La autorización de esta transcripción caducó. Pulsa «Renovar selección» antes de importar.'); return; }
    const previousAudio = activeAudioFile.current;
    const revisionAtRequest = subtitleImportRevision.current;
    // Ask BEFORE transferring up to 250 MiB, not after the bandwidth is spent.
    // The approval is valid only while the editor snapshot remains unchanged.
    const preflight = { source: previousAudio, edits: audioReplacementEdits.current };
    if (previousAudio && hasReplacementWork(preflight.edits) &&
        !window.confirm(replacementPrompt)) return;
    const controller = new AbortController();
    happyScribeMediaAbort.current = controller;
    setHappyScribeMediaImporting(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/admin/happyscribe/media', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, proof: item.importProof }),
      });
      // Abort can race with a response already resolved by fetch. Never consume
      // or import a media response after cancellation, even if it arrives late.
      if (controller.signal.aborted) return;
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(typeof body?.error === 'string'
          ? body.error : 'No fue posible importar el audio original.');
      }
      const blob = await response.blob();
      if (controller.signal.aborted ||
          revisionAtRequest !== subtitleImportRevision.current ||
          activeAudioFile.current !== previousAudio) return;
      if (!blob.size || blob.size > 250 * 1024 * 1024) {
        throw new Error('El audio está vacío o supera el límite de importación directa de 250 MiB.');
      }
      const filename = happyScribeImportFilename(item.name, 'mp3');
      const file = new File([blob], filename, { type: 'audio/mpeg' });
      chooseAudio(file, preflight);
      if (activeAudioFile.current !== file) return;
      setNotice('Audio original importado desde HappyScribe. Espera a que Audio Studio calcule su duración y después importa la transcripción para revisar y asignar los hablantes.');
    } catch (cause) {
      if (!controller.signal.aborted &&
          revisionAtRequest === subtitleImportRevision.current &&
          activeAudioFile.current === previousAudio) {
        setError(cause instanceof Error ? cause.message : 'No fue posible importar el audio desde HappyScribe.');
      }
    } finally {
      if (happyScribeMediaAbort.current === controller) {
        happyScribeMediaAbort.current = null;
        setHappyScribeMediaImporting(false);
      }
    }
  };

  const sourceRequiresLocal = audio !== null && usesLocalLongMode(audio, duration);
  const hasCompound = segments.some(segment => segment.ranges !== undefined);
  const localOnly = audio !== null && (sourceRequiresLocal || hasCompound || !allowServerZipExport);
  const productionMode = localOnly ? 'wav' : 'mp3';
  const activeProductionKeys = productionKeys && productionKeys.source === audio && productionKeys.cuts === segments &&
    productionKeys.mode === productionMode ? productionKeys.keys : null;
  useEffect(() => {
    if (!audio || !segments.length || (localOnly && (!currentWavPlan || currentWavPlan.issue))) {
      setProductionKeys(null);
      return;
    }
    let cancelled = false;
    const source = audio;
    const parts = localOnly ? currentWavPlan!.parts : publicationPlan.parts.length === 1 ? publicationPlan.parts : [];
    void Promise.all(parts.map(async part => [part.key, await studioProductionKey(source, part.turns, productionMode)] as const))
      .then(entries => { if (!cancelled) setProductionKeys({ source, cuts: segments, mode: productionMode, keys: new Map(entries) }); })
      .catch(() => { if (!cancelled) setProductionKeys(null); });
    return () => { cancelled = true; };
  }, [audio, segments, localOnly, currentWavPlan, publicationPlan, productionMode]);
  const readyAssignment = assignmentPackage && assignmentPackage.source === audio &&
    assignmentPackage.cuts === segments && assignmentPackage.revision === subtitleImportRevision.current &&
    (assignmentPackage.files ? (!assignmentPackage.partKey || assignmentPackage.partKey === publicationPartKey) : !localOnly)
    ? assignmentPackage : null;
  useEffect(() => {
    if (assignmentPackage && !readyAssignment) setAssignmentPackage(null);
  }, [assignmentPackage, readyAssignment]);
  const videoSource = audio !== null && mediaKind(audio) === 'video';
  const overlappingSelectedCues = useMemo(
    () => overlappingSelectedTimedCueIndices(reviewCues, chosenCueIndices),
    [reviewCues, chosenCueIndices],
  );
  // Retain the unfiltered SRT/VTT index for selections across pages.
  const filteredCueEntries = useMemo(() => {
    const query = cueSearch.trim().toLocaleLowerCase();
    const selectedIndices = new Set(chosenCueIndices);
    return reviewCues.flatMap((cue, index) => {
      if (showOnlySelectedCues && !selectedIndices.has(index)) return [];
      if (showCueReviewAlertsOnly && (!selectedIndices.has(index) ||
          (!cueRequiresEditorialReview(cue) && !overlappingSelectedCues.includes(index)))) return [];
      if (query && ![cue.text, cue.speaker || '', String(index + 1)]
        .some(value => value.toLocaleLowerCase().includes(query))) return [];
      return [{ cue, index }];
    });
  }, [reviewCues, cueSearch, showOnlySelectedCues, showCueReviewAlertsOnly, chosenCueIndices, overlappingSelectedCues]);
  // Validate the chosen editorial scope locally; publication has its own cap.
  const cueSelectionStatus = useMemo(() => {
    if (!chosenCueIndices.length) {
      return { seconds: 0, issue: 'Selecciona al menos una intervención.' };
    }
    try {
      const selected = selectTimedCues(reviewCues, chosenCueIndices, selectionPurpose);
      const seconds = selected.reduce((total, cue) => total + cue.end - cue.start, 0);
      return { seconds, issue: null };
    } catch (cause) {
      return { seconds: 0, issue: cause instanceof Error
        ? cause.message : 'Revisa los tiempos y solapamientos de los turnos seleccionados.' };
    }
  }, [reviewCues, chosenCueIndices, selectionPurpose]);
  const cueReviewSummary = useMemo(
    () => summarizeTimedCueReview(reviewCues, chosenCueIndices, duration),
    [reviewCues, chosenCueIndices, duration],
  );
  const selectedCueReviewAlerts = useMemo(
    () => [...new Set(chosenCueIndices)].filter(
      index => reviewCues[index] &&
        (cueRequiresEditorialReview(reviewCues[index]) || overlappingSelectedCues.includes(index)),
    ).length,
    [chosenCueIndices, reviewCues, overlappingSelectedCues],
  );
  const pageCount = Math.max(1, Math.ceil(filteredCueEntries.length / CUES_PER_PAGE));
  const currentCuePage = Math.min(cuePage, pageCount - 1);
  const visibleCues = filteredCueEntries.slice(
    currentCuePage * CUES_PER_PAGE, (currentCuePage + 1) * CUES_PER_PAGE);

  const coverage = useMemo(
    () => summarizeStudioCoverage(duration,
      segments.flatMap(segment => validStudioRanges(segment, duration) ?? [])),
    [duration, segments],
  );
  const largestGaps = useMemo(() => coverage.gaps
    .filter(gap => gap.duration >= 5)
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 8), [coverage]);

  // Only the selected row expands when reviewing a longer recording.
  const compactRows = !focusMode && (compactPreference ?? (sourceRequiresLocal || segments.length >= 6));
  const query = segmentSearch.trim().toLocaleLowerCase();
  // Editorial counts are independent of the playback cursor.
  const { pendingReviewCount, reviewedCount, unidentifiedSpeakerCount,
    unreviewedLanguageCount, originalInterpreterCount } = useMemo(() => {
    let pendingReviewCount = 0;
    let unidentifiedSpeakerCount = 0;
    let unreviewedLanguageCount = 0;
    let originalInterpreterCount = 0;
    for (const segment of segments) {
      if (needsReview(segment)) pendingReviewCount++;
      if (segment.speakerRole === 'unknown') unidentifiedSpeakerCount++;
      if (segment.speakerRole !== 'interpreter' && (segment.language === 'unknown' || hasStudioProfileLanguageMismatch(segment.speakerRole, segment.language))) unreviewedLanguageCount++;
      if (segment.speakerRole === 'interpreter') originalInterpreterCount++;
    }
    return { pendingReviewCount, reviewedCount: segments.length - pendingReviewCount,
      unidentifiedSpeakerCount, unreviewedLanguageCount, originalInterpreterCount };
  }, [segments]);
  const orderedSegments = useMemo(() => [...segments].sort((a, b) => a.start - b.start), [segments]);
  const reviewInspection = useMemo(() => inspectStudioReview(segments, duration), [segments, duration]);
  const confirmedIds = useMemo(() => new Set(reviewInspection.filter(({ turn, findings }) =>
    confirmedTurns.get(turn.id) === turn && findings.length === 0,
  ).map(({ turn }) => turn.id)), [reviewInspection, confirmedTurns]);
  const issueTurns = useMemo(() => reviewInspection.filter(item => item.findings.length > 0), [reviewInspection]);
  const readyUnconfirmed = useMemo(() => reviewInspection.filter(item =>
    !confirmedIds.has(item.turn.id) && item.findings.length === 0), [reviewInspection, confirmedIds]);
  const reviewEntries = useMemo(() => reviewCategory === 'unconfirmed'
    ? readyUnconfirmed
    : issueTurns.filter(item => reviewCategory === 'all' || item.findings.some(finding => finding.code === reviewCategory)),
  [reviewCategory, readyUnconfirmed, issueTurns]);
  const readyUnconfirmedCount = readyUnconfirmed.length;
  const reviewCategories: Array<{ code: StudioReviewCode; label: string }> = [
    { code: 'interpreter', label: 'Intérprete original' },
    { code: 'speaker', label: 'Hablante pendiente' },
    { code: 'language', label: 'Idioma por revisar' },
    { code: 'range', label: 'Límites de audio' },
    { code: 'overlap', label: 'Solapamientos' },
    { code: 'title', label: 'Títulos' },
    { code: 'instructions', label: 'Instrucciones' },
    { code: 'response', label: 'Tiempo de respuesta' },
  ];
  // Media time updates do not change the editorial list or pair eligibility.
  const visibleSegments = useMemo(() => orderedSegments
    .map((segment, index) => ({ segment, index }))
    .filter(({ segment }) => (!showPendingReview || (focusMode ? !confirmedIds.has(segment.id) : needsReview(segment))) &&
      (!query || [segment.title, segment.scriptPrompt, captionTexts[segment.id] || '',
        segment.speakerRole, segment.language, studioProfileSearchText(segment.speakerRole)]
        .some(value => value.toLocaleLowerCase().includes(query)))),
    [orderedSegments, showPendingReview, focusMode, confirmedIds, query, captionTexts]);
  const previewablePairIds = useMemo(() => {
    const visibleIds = new Set(visibleSegments.map(({ segment }) => segment.id));
    return new Set(visibleSegments.filter(({ segment, index }) => {
      const next = orderedSegments[index + 1];
      return next && visibleIds.has(next.id) && planGaplessPair(segment, next, duration);
    }).map(({ segment }) => segment.id));
  }, [visibleSegments, orderedSegments, duration]);

  // Keep a single editor in the same place. The full filtered collection is
  // still used for bulk actions, validation and gapless preview eligibility.
  const focusIndex = Math.max(0, visibleSegments.findIndex(({ segment }) =>
    segment.id === expandedSegmentId));
  const focusedTurn = visibleSegments[focusIndex];
  const renderedSegments = focusMode ? (focusedTurn ? [focusedTurn] : []) : visibleSegments;
  const focusedTurnId = focusedTurn?.segment.id;
  const sourceProfileCount = useMemo(() => focusedTurnId
    ? propagateSpeakerProfile(segments, focusedTurnId).changed : 0, [segments, focusedTurnId]);
  const selectFocusedTurn = (id: string) => {
    // Selecting another turn is not a request to keep listening to the old one.
    if (id !== focusedTurnId || previewingId?.startsWith('boundary-proposal:')) {
      stopPreview();
      stopPairPreview();
    }
    setAdvancedTurnId(null);
    setExpandedSegmentId(id);
    setReviewFocusRequest({ id, attempt: ++reviewFocusAttempt.current });
  };

  const focusedReviewIssue = reviewInspection.find(item => item.turn.id === focusedTurn?.segment.id)?.findings[0]?.message ?? null;
  const openReviewEntry = (id: string) => {
    const entry = reviewInspection.find(item => item.turn.id === id);
    if (!entry) return;
    setSegmentSearch('');
    setShowPendingReview(false);
    setFocusMode(true);
    setWorkspaceTab('edit');
    setTrashOpen(false);
    setReviewCenterOpen(false);
    selectFocusedTurn(id);
    if (entry.findings.some(finding => ['range', 'overlap', 'title', 'instructions', 'response'].includes(finding.code))) {
      setAdvancedTurnId(id);
    }
  };
  const boundaryProposal = useMemo(() => {
    const active = segments.find(turn => turn.id === focusedTurn?.segment.id);
    return active ? proposeStudioBoundaries(active, segments, duration, serverConsent ? detectedSilences : []) : null;
  }, [segments, focusedTurn?.segment.id, duration, serverConsent, detectedSilences]);
  const proposalPreviewId = focusedTurn ? 'boundary-proposal:' + focusedTurn.segment.id : '';
  const canUseBoundaryProposal = Boolean(focusedTurn && boundaryProposal && !busy && !draftBusy && !analyzingSilences);
  // Search, pending filters and edits can change the visible focus without a
  // navigation click. Stop stale bounded playback, including compound audio.
  const previousReviewFocus = useRef<{ mode: boolean; id: string | undefined }>({ mode: false, id: undefined });
  useEffect(() => {
    const previous = previousReviewFocus.current;
    previousReviewFocus.current = { mode: focusMode, id: focusedTurnId };
    if (!focusMode || (previous.mode && previous.id === focusedTurnId)) return;
    if (previewingId && previewingId !== focusedTurnId && previewingId !== proposalPreviewId) stopPreview();
    if (pairPreviewId && pairPreviewId !== focusedTurnId) stopPairPreview();
  }, [focusMode, focusedTurnId, previewingId, pairPreviewId, proposalPreviewId, stopPreview, stopPairPreview]);
  useEffect(() => {
    if (!previewingId?.startsWith('boundary-proposal:')) return;
    if (focusMode && (!immersiveMode || workspaceTab === 'edit') &&
        previewingId === proposalPreviewId && boundaryProposal) return;
    stopPreview();
  }, [previewingId, focusMode, immersiveMode, workspaceTab, proposalPreviewId, boundaryProposal]);
  const applyBoundaryProposal = () => {
    if (!focusedTurn || !boundaryProposal || !canUseBoundaryProposal) return;
    const current = focusedTurn.segment;
    // Recompute against the latest edit; no application of stale suggestions.
    const proposal = proposeStudioBoundaries(current, segments, duration, serverConsent ? detectedSilences : []);
    if (!proposal || proposal.start !== boundaryProposal.start || proposal.end !== boundaryProposal.end) return;
    subtitleImportRevision.current += 1;
    stopPreview();
    stopPairPreview();
    rememberEdit({
      kind: 'ajuste de tiempos', segments: [...segments],
      captions: { ...captionTexts }, expandedId: current.id,
    });
    setSegments(previous => previous.map(turn => turn.id === current.id
      ? { ...turn, start: proposal.start, end: proposal.end, sourceSpeakerGroup: undefined } : turn));
    setTurnActionFeedback(null);
    setError('');
    setNotice('Tiempos ajustados. Escucha el corte completo y confirma de nuevo; puedes deshacer el ajuste.');
  };
  const canConfirmFocused = Boolean(focusedTurn && !focusedReviewIssue && !busy && !draftBusy && !analyzingSilences);
  const confirmAndAdvance = () => {
    if (!focusedTurn || !canConfirmFocused) return;
    endEditGroup();
    const current = focusedTurn.segment;
    const confirmed = new Set(confirmedIds);
    confirmed.add(current.id);
    // Drop stale snapshots and never confirm a different turn by index.
    setConfirmedTurns(new Map(segments.filter(turn => confirmed.has(turn.id)).map(turn => [turn.id, turn])));
    stopPreview();
    stopPairPreview();
    setError('');
    setTurnActionFeedback(null);
    const next = nextUnconfirmedTurn(visibleSegments.map(({ segment }) => segment), current.id, confirmed);
    setNotice(next
      ? 'Intervención confirmada. Continúa con el siguiente turno sin confirmar.'
      : 'Intervención confirmada. No quedan turnos sin confirmar en esta selección.');
    if (next) selectFocusedTurn(next.id);
  };

  const archiveTurns = (turns: Segment[]) => {
    const incoming = turns.filter(turn => !excludedTurns.some(entry => entry.turn.id === turn.id));
    if (excludedTurns.length + incoming.length > STUDIO_MAX_EXCLUDED_TURNS) {
      setError('La papelera está llena. Recupera o elimina definitivamente cortes antes de excluir más.');
      return false;
    }
    setExcludedTurns(previous => [...previous, ...incoming.map(turn => ({ turn, caption: captionTexts[turn.id] }))]);
    return true;
  };
  const restoreExcluded = (id: string) => {
    const entry = excludedTurns.find(item => item.turn.id === id);
    if (!entry || busy || draftBusy || analyzingSilences) return;
    const issue = restoreExcludedIssue(entry.turn, segments, duration, editorLimit);
    if (issue) { setError(issue); return; }
    subtitleImportRevision.current += 1;
    stopPreview();
    stopPairPreview();
    rememberEdit({ kind: 'recuperación de papelera', segments, captions: captionTexts, expandedId: expandedSegmentId });
    const restored = { ...entry.turn };
    setSegments(previous => [...previous, restored]);
    if (entry.caption) setCaptionTexts(previous => ({ ...previous, [id]: entry.caption! }));
    setExcludedTurns(previous => previous.filter(item => item.turn.id !== id));
    setConfirmedTurns(previous => { const next = new Map(previous); next.delete(id); return next; });
    setSegmentSearch('');
    setShowPendingReview(false);
    setFocusMode(true);
    setWorkspaceTab('edit');
    selectFocusedTurn(id);
    setError('');
    setNotice('Intervención recuperada. Revisa el corte antes de confirmar.');
  };
  const discardExcluded = (id: string) => {
    if (!window.confirm('¿Eliminar definitivamente este corte de la papelera? También se limpiará el historial de deshacer y rehacer. La grabación original permanece intacta.')) return;
    subtitleImportRevision.current += 1;
    setExcludedTurns(previous => previous.filter(item => item.turn.id !== id));
    clearEditorialHistory();
    setError('');
    setNotice('Corte retirado de la papelera.');
  };
  const removeIntervention = (id: string, advance = false) => {
    const turn = segments.find(item => item.id === id);
    if (!turn || !archiveTurns([turn])) return;
    subtitleImportRevision.current += 1;
    stopPreview();
    stopPairPreview();
    rememberEdit({
      kind: 'eliminación', segments: [...segments],
      captions: { ...captionTexts }, expandedId: advance ? id : expandedSegmentId,
    });
    setSegments(prev => prev.filter(turn => turn.id !== id));
    setCaptionTexts(prev => {
      if (!Object.prototype.hasOwnProperty.call(prev, id)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setExpandedSegmentId(prev => prev === id ? null : prev);
    setAdvancedTurnId(null);
    setTurnActionFeedback(null);
    setError('');
    setNotice(advance
      ? 'Intervención excluida. Puedes recuperarla desde la papelera editorial.'
      : 'Intervención movida a la papelera editorial.');
    if (advance) {
      const visible = visibleSegments.map(({ segment }) => segment);
      const next = nextUnconfirmedTurn(visible, id, confirmedIds)
        ?? visible[focusIndex + 1] ?? visible[focusIndex - 1];
      if (next) selectFocusedTurn(next.id);
    }
  };

  const { pendingLanguageIds, profileLanguagePendingIds, pendingSpeakerIds, pendingClientIds, pendingSpanishIds } = useMemo(() => {
    const pendingLanguageIds: string[] = [];
    const profileLanguagePendingIds: string[] = [];
    const pendingSpeakerIds: string[] = [];
    const pendingClientIds: string[] = [];
    const pendingSpanishIds: string[] = [];
    for (const { segment } of visibleSegments) {
      if (segment.language === 'unknown' && segment.speakerRole === 'unknown') pendingLanguageIds.push(segment.id);
      if (segment.language === 'unknown' && segment.speakerRole !== 'interpreter' && studioEditorialProfile(segment.speakerRole)) profileLanguagePendingIds.push(segment.id);
      if (segment.speakerRole === 'unknown') {
        pendingSpeakerIds.push(segment.id);
        if (segment.language === 'unknown' || segment.language === 'en') pendingClientIds.push(segment.id);
        if (segment.language === 'unknown' || segment.language === 'es') pendingSpanishIds.push(segment.id);
      }
    }
    return { pendingLanguageIds, profileLanguagePendingIds, pendingSpeakerIds, pendingClientIds, pendingSpanishIds };
  }, [visibleSegments]);
  const visiblePendingTurns = useMemo(() => visibleSegments.filter(({ segment }) =>
    focusMode ? !confirmedIds.has(segment.id) : needsReview(segment)), [visibleSegments, focusMode, confirmedIds]);
  const focusPendingTurn = (direction: -1 | 1) => {
    if (!visiblePendingTurns.length) return;
    const currentIndex = visiblePendingTurns.findIndex(({ segment }) =>
      segment.id === (focusMode ? focusedTurn?.segment.id : reviewFocusRequest?.id));
    // If filtering hid the previously selected turn, start from the first
    // pending in the chosen direction rather than navigating a hidden row.
    const index = currentIndex < 0
      ? direction === 1 ? 0 : visiblePendingTurns.length - 1
      : (currentIndex + direction + visiblePendingTurns.length) % visiblePendingTurns.length;
    const next = visiblePendingTurns[index].segment;
    // Pending navigation is available in the finalization header too.
    // Reveal the editor before the review-focus effect runs.
    setWorkspaceTab('edit');
    selectFocusedTurn(next.id);
  };

  const sourceReady = Boolean(audio && duration > 0);
  const workspaceActive = immersiveMode && focusMode && sourceReady;
  const workspaceTurnId = focusedTurn?.segment.id;
  const applyRecoveredProject = (saved: RestoredStudioRecovery) => {
    const restored = saved.segments.map(segment => ({ ...segment, id: crypto.randomUUID() }));
    subtitleImportRevision.current += 1;
    stopPreview();
    stopPairPreview();
    setSegments(restored);
    setExcludedTurns(saved.excluded.map(turn => ({ turn: { ...turn, id: crypto.randomUUID() } })));
    setTrashOpen(false);
    setConfirmedTurns(new Map(restored.filter((turn, index) => saved.confirmed.has(index) &&
      !studioReviewIssue(turn, restored, duration)).map(turn => [turn.id, turn])));
    setCaptionTexts({});
    setReviewCues([]);
    setChosenCueIndices([]);
    setSuggestedClips([]);
    setDetectedSilences([]);
    setOmittedSuggestions(0);
    setLocalVadSnapshot(null);
    clearEditorialHistory();
    setTurnActionFeedback(null);
    setSegmentSearch('');
    setShowPendingReview(false);
    setExpandedEditor(restored.length > ROLEPLAY_MAX_SCENARIOS);
    setFocusMode(true);
    setWorkspaceTab('edit');
    setAdvancedTurnId(null);
    setExpandedSegmentId(restored[saved.active]?.id ?? restored[0]?.id ?? null);
    setAllowServerZipExport(false);
    setServerConsent(false);
    seekAudio(saved.playhead);
    setNotice('Progreso recuperado. La transcripción privada y las sugerencias sin aplicar no forman parte del respaldo.');
  };
  const {
    recoveryEnabled, recoveryAvailable, recoveryStatus, resetRecoveryForSource,
    startRecovery, pauseRecovery, clearRecovery, flushRecovery,
  } = useStudioLocalRecovery({
    audio, duration, segments, excludedTurns, confirmedIds, workspaceTurnId, activeProductionKeys,
    activeAudioFile, editorRevision: subtitleImportRevision, player,
    disabled: busy || draftBusy || analyzingSilences, hasActiveEditorWork,
    onRestore: applyRecoveredProject,
  });

  useEffect(() => {
    if (workspaceActive && workspaceContent.current) workspaceContent.current.scrollTop = 0;
  }, [workspaceActive, workspaceTab, workspaceTurnId]);
  useEffect(() => {
    if (workspaceActive && !wasWorkspaceActive.current) workspaceExit.current?.focus({ preventScroll: true });
    if (!workspaceActive && wasWorkspaceActive.current) workspaceEnter.current?.focus({ preventScroll: true });
    wasWorkspaceActive.current = workspaceActive;
  }, [workspaceActive]);
  const cardActions = useStudioCardActions({
    seekAudio, splitAtPlayhead, mergeWithNext, separateCompound,
    previewPairWithoutGap, previewSegment, removeIntervention, update,
    insertProtocol, markAtPlayhead, applyBoundaryProposal,
    onToggleExpanded: id => setExpandedSegmentId(previous => previous === id ? null : id),
    onToggleAdvanced: id => setAdvancedTurnId(previous => previous === id ? null : id),
  });
  const studioSteps = [
    { id: 'studio-source', title: '1. Grabación', detail: sourceReady ? 'Grabación lista' : 'Selecciona audio o video', available: true, done: sourceReady },
    { id: reviewCues.length ? 'studio-transcript-review' : 'studio-subtitles', title: '2. Transcripción', detail: reviewCues.length ? 'Turnos para seleccionar' : 'Importa subtítulos o usa cortes manuales', available: sourceReady, done: segments.length > 0 && reviewCues.length === 0 },
    { id: 'studio-turns', title: '3. Intervenciones', detail: segments.length ? `${segments.length} turnos · ${pendingReviewCount} pendientes` : 'Revisa voces, idiomas y cortes', available: sourceReady, done: segments.length > 0 && pendingReviewCount === 0 },
    { id: 'studio-export', title: '4. Exportación', detail: 'Prepara el paquete para asignar', available: sourceReady && segments.length > 0, done: false },
  ];

  return (
    <main data-studio-workspace={workspaceActive ? "active" : undefined} className={workspaceActive ? undefined : "space-y-4"}
      onKeyDown={event => {
        if (!focusMode || (workspaceActive && workspaceTab !== 'edit') || event.defaultPrevented || event.repeat || event.nativeEvent.isComposing ||
            !isStudioShortcutTarget(event.target)) return;
        // Single-key shortcuts are scoped to the explicitly focused article,
        // never to buttons, fields or the rest of the document.
        if (focusedTurn && event.target instanceof HTMLElement &&
            event.target.id === 'studio-intervention-' + focusedTurn.segment.id &&
            event.target === document.activeElement &&
            !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey &&
            !busy && !draftBusy && !analyzingSilences) {
          const key = event.key;
          if (key === ' ') {
            event.preventDefault();
            previewSegment(focusedTurn.segment);
            return;
          }
          if (key === '1' || key === '2' || key === '3') {
            event.preventDefault();
            update(focusedTurn.segment.id, studioProfileSelection(focusedTurn.segment.speakerRole,
              key === '1' ? 'doctor' : key === '2' ? 'patient' : 'interpreter'));
            return;
          }
          if (key === 'ArrowLeft' || key === 'ArrowRight') {
            const next = visibleSegments[focusIndex + (key === 'ArrowLeft' ? -1 : 1)];
            if (next) {
              event.preventDefault();
              selectFocusedTurn(next.segment.id);
            }
            return;
          }
        }
        if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y')) {
          const redo = event.shiftKey || event.key.toLowerCase() === 'y';
          if (redo ? nextStructuralEdit : lastStructuralEdit) { event.preventDefault(); applyEditorialHistory(redo ? 'redo' : 'undo'); }
          return;
        }
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && canConfirmFocused) {
          event.preventDefault();
          confirmAndAdvance();
        }
      }}>
      <div hidden={workspaceActive} className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/admin/roleplays" onClick={event => {
            if (!confirmEditorNavigation()) event.preventDefault();
          }} className="mb-3 inline-flex items-center gap-2 text-sm text-[var(--theme-link)]"><ArrowLeft size={16} /> Volver a roleplays</Link>
          <h1 className="text-3xl font-bold text-[var(--foreground)]">Estudio de audio para roleplays</h1>
          <p className="mt-2 max-w-3xl text-sm text-[var(--text-secondary)]">
            Prepara intervenciones desde una grabación de audio o video sin crear sesiones
            ni modificar audios publicados. Los MP3 pequeños permiten exportar el ZIP;
            fuentes extensas se revisan localmente. Los MP3 pequeños también se preparan sin subirlos,
            salvo que selecciones expresamente la exportación en servidor.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/roleplays/creation-readiness" prefetch={false} target="_blank" rel="noopener noreferrer" className="theme-action-secondary inline-flex min-h-11 items-center rounded-xl px-4 py-3 text-sm font-semibold">Diagnóstico (nueva pestaña)</Link>
          <Link href="/admin/roleplays/settings" onClick={event => {
            if (!confirmEditorNavigation()) event.preventDefault();
          }} className="theme-action-secondary rounded-xl px-4 py-3 text-sm font-semibold">Configurar Audio Studio</Link>
          <Link href="/admin/roleplays/new" onClick={event => {
            if (!confirmEditorNavigation()) event.preventDefault();
          }} className="rounded-xl theme-action-primary px-4 py-3 font-semibold">Importar y asignar</Link>
        </div>
      </header>
      <nav aria-label="Ruta de creación del roleplay" className="rounded-2xl border border-[var(--border)] bg-[var(--theme-panel)] p-4">
        <p className="mb-3 text-sm font-semibold text-[var(--foreground)]">Crea tu roleplay en cuatro pasos</p>
        <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {studioSteps.map(step => (
            <li key={step.id} className="min-w-0">
              {step.available ? (
                <a href={`#${step.id}`} className="block h-full rounded-xl border border-[var(--border)] bg-[var(--theme-surface-muted)] p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
                  <span className="block text-sm font-semibold text-[var(--foreground)]">{step.title}</span>
                  <span className="mt-1 block text-xs text-[var(--text-secondary)]">{step.detail}</span>
                  {step.done && <span className="mt-1 block text-xs font-semibold text-[var(--theme-success)]">Listo</span>}
                </a>
              ) : (
                <div className="h-full rounded-xl border border-[var(--border)] p-3">
                  <span className="block text-sm font-semibold text-[var(--text-secondary)]">{step.title}</span>
                  <span className="mt-1 block text-xs text-[var(--text-secondary)]">{step.detail}</span>
                  <span className="mt-1 block text-xs text-[var(--text-secondary)]">Aún no disponible</span>
                </div>
              )}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-[var(--text-secondary)]">Puedes volver a cualquier paso disponible sin perder los cambios. La transcripción es opcional.</p>
      </nav>
      <section id="studio-source" tabIndex={-1} className="scroll-mt-6 rounded-2xl border border-[var(--border)] bg-[var(--theme-panel)] p-4">
        <label htmlFor="studio-audio" className="block text-sm font-semibold text-[var(--foreground)]">
          Grabación original MP3 o video/audio largo (local, hasta 8 GiB)
        </label>
        <input id="studio-audio" type="file"
          accept=".mp3,.m4a,.wav,.aac,.ogg,.oga,.opus,.flac,.mp4,.m4v,.mov,.webm,.mkv,audio/*,video/*"
          className="mt-2 block w-full text-sm text-[var(--text-secondary)]"
          onChange={event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            // Browsers may dispatch a change event with no files when the
            // picker is cancelled. Preserve the existing source and edits.
            if (file) chooseAudio(file);
          }} />
        <div className="mt-3 space-y-2 rounded-lg border border-[var(--border)] p-3">
          <h3 className="text-sm font-semibold text-[var(--foreground)]">Recuperación local del proyecto</h3>
          <p className="text-xs text-[var(--text-secondary)]">Opcional, solo en este navegador y equipo de confianza. Guarda cortes, títulos, instrucciones, confirmaciones y huellas de intentos de producción sin audio, destinatarios, enlaces privados ni transcripción privada. Para recuperar, selecciona la misma grabación. Otros usuarios de este navegador podrían acceder al respaldo; elimínalo al terminar.</p>
          <div className="flex flex-wrap gap-2">
            {!recoveryEnabled && !recoveryAvailable && <button type="button" disabled={!sourceReady || busy || draftBusy || analyzingSilences}
              onClick={() => void startRecovery(false)} className="theme-action-secondary rounded-lg px-3 py-2 text-xs font-semibold">Activar guardado local</button>}
            {!recoveryEnabled && recoveryAvailable && <button type="button" disabled={!sourceReady || busy || draftBusy || analyzingSilences}
              onClick={() => void startRecovery(true)} className="theme-action-primary rounded-lg px-3 py-2 text-xs font-semibold">Recuperar respaldo local</button>}
            {recoveryEnabled && <button type="button" onClick={pauseRecovery}
              className="theme-action-secondary rounded-lg px-3 py-2 text-xs font-semibold">Pausar guardado local</button>}
            {(recoveryAvailable || recoveryEnabled) && <button type="button" onClick={clearRecovery}
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs text-[var(--theme-danger)]">Eliminar respaldo local</button>}
          </div>
          {recoveryStatus && <p role="status" aria-label="Estado del respaldo local" className="text-xs text-[var(--text-secondary)]">{recoveryStatus}</p>}
        </div>
        {/* Keep the provider panel available before a source is selected. */}
        <HappyScribeLibraryPanel key={happyScribeFilterEpoch}
          items={happyScribeItems} selectedId={happyScribeSelectedId}
          loading={happyScribeLoading} importing={happyScribeImporting}
          mediaImporting={happyScribeMediaImporting} mediaEnabled={happyScribeMediaEnabled}
          hasMore={happyScribeHasMore} configUnavailable={happyScribeConfigUnavailable}
          onRefresh={() => void loadHappyScribeItems()}
          onLoadMore={() => void loadHappyScribeItems(happyScribePage + 1)}
          onRenew={() => {
            if (!happyScribeSelection) return;
            const page = happyScribeOrigins.current.get(happyScribeSelection.id);
            if (page !== undefined) void loadHappyScribeItems(page, happyScribeSelection.id);
          }}
          onSelect={id => {
            // Changing selection invalidates the pending media download.
            happyScribeMediaAbort.current?.abort();
            happyScribeMediaAbort.current = null;
            setHappyScribeMediaImporting(false);
            setHappyScribeSelectedId(id);
          }}
          onImportAudio={() => void importHappyScribeAudio()}
          onImportTranscript={() => void importHappyScribeTranscript()}
          onCancelAudio={() => {
            happyScribeMediaAbort.current?.abort();
            happyScribeMediaAbort.current = null;
            setHappyScribeMediaImporting(false);
            setNotice('Descarga de audio cancelada. Puedes seguir trabajando con la grabación actual.');
          }}
          onCancelTranscript={() => {
            happyScribeTranscriptAbort.current?.abort();
            happyScribeTranscriptAbort.current = null;
            subtitleImportRevision.current += 1;
            setHappyScribeImporting(false);
          }}
        />

        {url && (
          <div className="mt-5 space-y-3">
            {videoSource
              ? <video ref={attachPlayer} src={url} controls preload="metadata" playsInline
                  {...mediaHandlers} className="max-h-64 w-full rounded-lg bg-black"/>
              : <audio ref={attachPlayer} src={url} controls preload="metadata"
                  {...mediaHandlers} className="w-full"/>}
        {url && <audio ref={pairPlayer} src={url} preload="none"
          aria-label="Reproductor de preescucha sin pausa"
          {...pairMediaHandlers}
           className="hidden" />}
            <div id="studio-subtitles" tabIndex={-1} className="scroll-mt-6 rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
              <label htmlFor="studio-transcript" className="block text-sm font-semibold text-[var(--theme-link)]">
                Opcional: importar tiempos de transcripción SRT / WebVTT
              </label>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">Importa los subtítulos para preparar los turnos sin marcar cada tiempo a mano. Si no tienes subtítulos, usa el editor de audio de abajo.</p>
              <details className="mt-2 text-xs text-[var(--text-secondary)]">
                <summary className="cursor-pointer font-medium text-[var(--theme-link)]">Ayuda con los formatos de HappyScribe</summary>
                <p className="mt-1">
                ¿HappyScribe descargó un .md? No es un proyecto JSON ni un archivo de subtítulos con tiempos.
                Usa «Importar transcripción» en la biblioteca HappyScribe de arriba (solicita SRT automáticamente),
                o exporta un .srt desde HappyScribe. No es necesario convertir archivos manualmente.
                </p>
              </details>
              <input id="studio-transcript" type="file" accept=".srt,.vtt,text/vtt,application/x-subrip"
                className="mt-2 block w-full text-sm text-[var(--text-secondary)]"
                onChange={event => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = '';
                  if (file) void importSubtitles(file);
                }}/>
              <label className="mt-3 flex items-center gap-2 text-sm text-[var(--foreground)]">
                <input type="checkbox" checked={excludeInterpreter}
                  onChange={event => {
                    subtitleImportRevision.current += 1;
                    preferenceEdits.current.exclude = true;
                    setExcludeInterpreter(event.currentTarget.checked);
                  }}
                  className="h-4 w-4 accent-blue-500"/>
                Excluir intervenciones del intérprete original al importar
              </label>
              <p className="mt-2 text-xs text-[var(--text-secondary)]">
                El filtro solo reconoce etiquetas genéricas exactas (por ejemplo, Interpreter o Intérprete).
                Revisa manualmente cualquier hablante desconocido. Se importan los tiempos y solo las etiquetas genéricas de rol (Médico, Paciente, etc.).
                Los nombres personales se reemplazan por títulos neutrales. La transcripción se muestra
                únicamente aquí y no se envía al participante. Revisa y excluye las intervenciones del intérprete.
              </p>
            </div>
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
            <p className="text-xs text-[var(--text-secondary)]">
              Duración: {formatTime(duration)} · Navega por la línea de tiempo
              y marca los límites en el cursor. El zoom no decodifica el archivo completo.
            </p>
            {segments.length > 0 && (
              <section aria-label="Resumen de cortes y espacios" className="rounded-lg border border-cyan-300/15 bg-[var(--theme-surface-muted)] p-2.5">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                  <span className="font-semibold text-[var(--theme-info)]">
                    Seleccionado: {formatTime(coverage.selectedSeconds)}
                  </span>
                  <span className="text-[var(--text-secondary)]">
                    Fuera de cortes: {formatTime(coverage.excludedSeconds)}
                  </span>
                  <span className="text-[var(--text-secondary)]">
                    {segments.length} intervenciones
                  </span>
                </div>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  El paquete reúne únicamente los cortes seleccionados, sin los espacios intermedios.
                  Los intervalos fuera de cortes pueden contener conversaciones: no son silencios detectados.
                </p>
                {coverage.hasOverlaps && (
                  <p className="mt-1 text-xs font-semibold text-[var(--theme-warning)]">
                    Hay intervenciones solapadas. Corrige sus límites antes de exportar.
                  </p>
                )}
                {largestGaps.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-medium text-[var(--theme-info)]">
                      Revisar los {largestGaps.length} espacios sin cortes más extensos (al menos 5 s)
                    </summary>
                    <div className="mt-2 flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                      {largestGaps.map(gap => (
                        <button key={`${gap.start}-${gap.end}`} type="button"
                          onClick={() => seekAudio(gap.start + Math.min(2, gap.duration / 2))}
                          aria-label={`Escuchar espacio sin cortes desde ${formatTime(gap.start)}`}
                          className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:border-cyan-300/40">
                          {formatTime(gap.start)}–{formatTime(gap.end)}
                          <span className="ml-1 text-[var(--theme-info)]">({formatTime(gap.duration)})</span>
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
                onPreview={previewVadRegion}
                onApply={(detected) => {
                  if (!detected.length) return;
                  subtitleImportRevision.current += 1;
                  stopPairPreview();
                  // One batch is a single reversible edit; no audio is persisted.
                  rememberEdit({
                    kind: 'adición VAD', segments: [...segments],
                    captions: { ...captionTexts }, expandedId: expandedSegmentId,
                  });
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
                  setNotice('Cortes VAD añadidos sin solaparse con los anteriores. Puedes deshacer esta adición; revisa hablantes, idioma y límites antes de exportar.');
                }}
              />
            )}
            {!sourceRequiresLocal && <div className="rounded-xl border border-violet-400/20 bg-violet-400/5 p-4">
              <h2 className="text-sm font-bold text-[var(--theme-purple)]">Respaldo opcional: detección en servidor</h2>
              <p className="mt-2 text-xs leading-5 text-[var(--text-secondary)]">
                Utiliza el detector local anterior para no subir la grabación ni consumir
                recursos del servidor. Si el navegador no puede decodificar el MP3,
                puedes autorizar un análisis temporal con FFmpeg en nuestro servidor.
                No transcribe ni identifica al médico, paciente o intérprete.
                No se guarda en la biblioteca, pero el archivo sí se transmite para procesarlo.
              </p>
              <label className="mt-3 flex items-start gap-2 text-xs leading-5 text-[var(--foreground)]">
                <input type="checkbox" className="mt-1 accent-violet-400"
                  checked={serverConsent}
                  onChange={event => {
                    const allowed = event.currentTarget.checked;
                    setServerConsent(allowed);
                    if (!allowed) {
                      // Revocation also releases server-derived pause metadata
                      // held in undo and redo history; keep the older cuts.
                      forgetServerSuggestions();
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
                className="mt-3 rounded-lg border border-violet-300/30 bg-violet-500/20 px-4 py-2 text-sm font-semibold text-[var(--theme-purple)] disabled:opacity-50">
                {analyzingSilences ? 'Analizando pausas…' : 'Detectar pausas en servidor'}
              </button>
              {detectedSilences.length > 0 && (
                <div className="mt-3 space-y-2">
                  <p className="text-sm text-[var(--foreground)]">
                    {detectedSilences.length} pausas detectadas · {suggestedClips.length} cortes sugeridos
                    {omittedSuggestions > 0 ? ` · ${omittedSuggestions} intervalos omitidos por los límites` : ''}
                  </p>
                  <div className="flex max-h-36 flex-wrap gap-2 overflow-y-auto">
                    {detectedSilences.slice(0, 40).map((pause, index) => (
                      <button key={index} type="button"
                        onClick={() => seekAudio((pause.start + pause.end) / 2)}
                        className="rounded-md border border-[var(--border)] bg-[var(--theme-surface-muted)] px-2 py-1 text-xs text-[var(--theme-link)]">
                        Pausa {index + 1}: {formatTime(pause.start)}–{formatTime(pause.end)}
                      </button>
                    ))}
                  </div>
                  {detectedSilences.length > 40 && (
                    <p className="text-xs text-[var(--text-secondary)]">Se muestran las primeras 40 pausas. Navega el resto con la línea de tiempo.</p>
                  )}
                </div>
              )}
              {suggestedClips.length > 0 && (
                <div className="mt-3 space-y-2">
                  <p className="text-xs leading-5 text-[var(--theme-warning)]">
                    Las sugerencias pueden dividir frases o incluir la voz del intérprete original.
                    Aplicarlas reemplazará los segmentos actuales; los títulos e idiomas quedarán por revisar.
                  </p>
                  <button type="button" onClick={applySilenceSuggestions}
                    disabled={analyzingSilences || busy || draftBusy}
                    className="rounded-lg theme-action-primary px-4 py-2 text-sm font-bold">
                    Reemplazar con {suggestedClips.length} cortes sugeridos
                  </button>
                </div>
              )}
            </div>}

          </div>
        )}
      </section>
      {audio && duration > 0 && reviewCues.length > 0 && (
        <section id="studio-transcript-review" tabIndex={-1} className="scroll-mt-6 space-y-4 rounded-2xl border border-amber-400/25 bg-amber-400/5 p-5">
          <h2 className="text-lg font-bold text-[var(--foreground)]">Seleccionar turnos de la transcripción</h2>
          <p className="text-sm text-[var(--text-secondary)]">
            Hay {reviewCues.length} turnos disponibles y {chosenCueIndices.length} seleccionados
            (máximo {editorLimit}{expandedEditor ? ' en edición' : ''}). La propuesta abarca distintos momentos de la grabación.
            Escucha y ajusta los turnos; después pulsa «Aplicar» para revisar hablantes e idiomas.
            Tus cortes actuales no se reemplazan sin confirmación.
          </p>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
            <input type="search" aria-label="Buscar turnos en transcripción"
              value={cueSearch} placeholder="Buscar texto, hablante o número…"
              onChange={event => { setCueSearch(event.currentTarget.value); setCuePage(0); }}
              className="min-w-0 flex-1 rounded-md border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] px-2 py-1.5 text-[var(--theme-control-text)] placeholder:text-[var(--text-tertiary)]"/>
            <label className="flex shrink-0 items-center gap-1.5">
              <input type="checkbox" checked={showOnlySelectedCues}
                onChange={event => { setShowOnlySelectedCues(event.currentTarget.checked); setShowCueReviewAlertsOnly(false); setCuePage(0); }}
                className="h-4 w-4 accent-amber-400"/>
              Solo seleccionados
            </label>
            <button type="button"
              onClick={() => completeFilteredCueSelection(visibleCues.map(entry => entry.index))}
              disabled={visibleCues.length === 0 || chosenCueIndices.length >= editorLimit}
              className="rounded border border-amber-300/30 px-2 py-1 text-xs font-semibold text-[var(--theme-warning)] disabled:opacity-40">
              Completar con turnos compatibles de esta página
            </button>
            <button type="button" onClick={expandCueProject}
              disabled={chosenCueIndices.length >= STUDIO_MAX_EDITOR_SEGMENTS}
              className="rounded border border-[var(--border)] px-2 py-1 text-xs font-semibold text-[var(--theme-link)] disabled:opacity-40">
              Ampliar selección compatible (hasta {STUDIO_MAX_EDITOR_SEGMENTS})
            </button>
            <button type="button" onClick={restoreBalancedCueSuggestion}
              disabled={reviewCues.length === 0}
              className="rounded border border-blue-300/30 px-2 py-1 text-xs font-semibold text-[var(--theme-link)] disabled:opacity-40">
              Recuperar propuesta equilibrada
            </button>
            <button type="button" onClick={clearCueSelection}
              disabled={chosenCueIndices.length === 0}
              className="rounded border border-[var(--border)] px-2 py-1 text-xs disabled:opacity-40">
              Limpiar selección SRT
            </button>
          </div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-secondary)]">
            <span>
              {filteredCueEntries.length
                ? `Mostrando ${currentCuePage * CUES_PER_PAGE + 1}–${Math.min((currentCuePage + 1) * CUES_PER_PAGE, filteredCueEntries.length)} de ${filteredCueEntries.length} turnos`
                : 'Ningún turno coincide con los filtros'}
              {filteredCueEntries.length !== reviewCues.length ? ` · ${reviewCues.length} en origen` : ''}
            </span>
            <div className="flex items-center gap-2">
              <button type="button" aria-label="Anterior página SRT"
                onClick={() => setCuePage(page => Math.max(0, page - 1))}
                disabled={currentCuePage === 0} className="rounded border border-[var(--border)] px-2 py-1 disabled:opacity-30">
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
                  className="w-14 rounded border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] px-1 py-1 text-center text-xs text-[var(--theme-control-text)]"/>
                / {pageCount}
              </label>
              <button type="button" aria-label="Siguiente página SRT"
                onClick={() => setCuePage(page => Math.min(pageCount - 1, page + 1))}
                disabled={currentCuePage >= pageCount - 1}
                className="rounded border border-[var(--border)] px-2 py-1 disabled:opacity-30">
                Siguiente
              </button>
            </div>
          </div>
          <div className="max-h-80 space-y-2 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--theme-surface-muted)] p-3">
            {visibleCues.map(({ cue, index }) => {
              return (
              <div key={index} className="flex items-start gap-3 rounded-lg border border-[var(--border)] p-2">
                <input type="checkbox" checked={chosenCueIndices.includes(index)}
                  aria-label={`Seleccionar turno ${index + 1}`}
                  onChange={() => toggleCueSelection(index)}
                  className="mt-1 h-4 w-4 shrink-0 accent-blue-500"/>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-[var(--theme-warning)]">
                    {index + 1} · {formatTime(cue.start)}–{formatTime(cue.end)} ·
                    {classifySpeakerRole(cue.speaker) === 'unknown'
                      ? ' Hablante por revisar'
                      : ` ${cue.speaker}`}
                    {overlappingSelectedCues.includes(index) && (
                      <span className="font-semibold text-[var(--theme-danger)]"> · Solapa otro turno seleccionado</span>
                    )}
                  </p>
                  <p className="mt-1 break-words text-xs text-[var(--text-secondary)]">
                    {cue.text.slice(0, 200)}{cue.text.length > 200 ? '…' : ''}
                  </p>
                </div>
                <button type="button" onClick={() => previewSubtitleCue(cue, index)}
                  aria-label={previewingId === `subtitle-${index}`
                    ? `Detener escucha de turno ${index + 1}`
                    : `Escuchar solo turno ${index + 1}`}
                  aria-pressed={previewingId === `subtitle-${index}`}
                  className="shrink-0 text-xs text-[var(--theme-link)] hover:underline">
                  {previewingId === `subtitle-${index}` ? 'Detener' : 'Escuchar turno'}
                </button>
              </div>
            ); })}
          </div>
          <p role="status" aria-label="Estado de selección SRT"
            className="text-xs leading-5 text-[var(--foreground)]">
            {cueSelectionStatus.issue
              ? `Selección no válida: ${cueSelectionStatus.issue}`
              : `Audio seleccionado: ${formatTime(cueSelectionStatus.seconds)}${expandedEditor ? ' (proyecto editorial; exportación limitada a 15:00)' : ' de 15:00 como máximo'}. Verifica los roles antes de aplicar.`}
          </p>
          {(chosenCueIndices.length > 0 || showCueReviewAlertsOnly) && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              {chosenCueIndices.length > 0 && <p role="status" aria-label="Resumen de calidad de selección SRT"
                className="text-xs leading-5 text-[var(--theme-warning)]">
                Revisión rápida antes de aplicar: {cueReviewSummary.unknownSpeakers} sin hablante identificado
                {' · '}{cueReviewSummary.originalInterpreters} del intérprete original
                {' · '}{cueReviewSummary.longCues} cortes de más de 1 minuto
                {' · '}{overlappingSelectedCues.length} turnos solapados
                {cueReviewSummary.sourceThirds !== null &&
                  <> · {cueReviewSummary.sourceThirds}/3 partes de la grabación representadas</>}.
                Escucha y confirma cada voz; estos datos se basan solo en etiquetas y tiempos.
              </p>}
              {(selectedCueReviewAlerts > 0 || showCueReviewAlertsOnly) && (
                <button type="button"
                  onClick={() => {
                    const nextAlertsOnly = !showCueReviewAlertsOnly;
                    setShowCueReviewAlertsOnly(nextAlertsOnly);
                    setShowOnlySelectedCues(nextAlertsOnly || chosenCueIndices.length > 0);
                    setCueSearch('');
                    setCuePage(0);
                  }}
                  aria-pressed={showCueReviewAlertsOnly}
                  className="rounded border border-amber-300/30 px-3 py-1.5 text-xs font-semibold text-[var(--theme-warning)] hover:bg-amber-300/10">
                  {showCueReviewAlertsOnly
                    ? chosenCueIndices.length > 0 ? 'Volver a turnos seleccionados' : 'Mostrar todos los turnos'
                    : selectedCueReviewAlerts === 1 ? 'Revisar 1 turno con alerta' : `Revisar ${selectedCueReviewAlerts} turnos con alertas`}
                </button>
              )}
            </div>
          )}
          <button type="button" onClick={applyCueSelection}
            disabled={cueSelectionStatus.issue !== null}
            className="rounded-xl bg-amber-500/20 px-4 py-2 text-sm font-bold text-[var(--theme-warning)] hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-40">
            Aplicar selección al editor ({chosenCueIndices.length})
          </button>
        </section>
      )}
      {audio && duration > 0 && (
        <section className="space-y-3 rounded-2xl border border-indigo-400/20 bg-indigo-400/5 p-5">
          <h2 className="text-lg font-bold text-[var(--foreground)]">Proyecto de edición</h2>
          <p className="text-sm leading-6 text-[var(--text-secondary)]">
            {localOnly
              ? 'Guarda los tiempos y perfiles sin subir el archivo. El proyecto se vincula a la fuente mediante tamaño, duración y SHA-256 de muestras: no es una verificación de todos sus bytes.'
              : 'Guarda los cortes y perfiles. El proyecto se verifica contra el MP3 original mediante SHA-256 completo.'}
            El JSON no contiene audio, video ni transcripción, pero sí títulos e instrucciones:
            protégelo si contienen información sensible. Un .md o un JSON exportado por HappyScribe
            no son proyectos de Audio Studio: importa primero el SRT/VTT, verifica las intervenciones
            y usa «Guardar proyecto JSON» aquí para crear un proyecto compatible.
          </p>
          {hasUnstoredDraftContext && (
            <p className="text-xs leading-5 text-[var(--theme-warning)]" aria-label="Contenido no incluido en el proyecto JSON">
              Atención: el JSON no guarda referencias privadas de transcripción, turnos SRT
              todavía sin aplicar, sugerencias sin confirmar ni el historial de «Deshacer».
              Aplica los cortes que necesites y conserva los SRT/VTT originales antes de abandonar el editor.
            </p>
          )}
          <div className="flex flex-wrap items-end gap-4">
            <button type="button" onClick={() => void saveDraft()}
              disabled={busy || draftBusy}
              className="rounded-xl border border-indigo-300/30 bg-indigo-500/20 px-4 py-2 text-sm font-semibold text-[var(--theme-purple)] disabled:opacity-50">
              {draftBusy ? 'Verificando proyecto…' : 'Guardar proyecto JSON'}
            </button>
            {hasActiveEditorWork && (
              <span className="text-xs text-[var(--theme-purple)]">Atajo: Ctrl/⌘+S · descarga local</span>
            )}
            <div className="space-y-2">
              <label className="block text-sm text-[var(--theme-purple)]">
                Abrir proyecto JSON de la grabación seleccionada
                <input type="file" accept=".json,application/json"
                  disabled={busy || draftBusy}
                  onChange={event => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = '';
                    if (file) void openDraftFile(file);
                  }}
                  className="mt-2 block w-full text-xs text-[var(--text-secondary)] disabled:opacity-50"/>
              </label>
              <div role="group" aria-label="Zona para recuperar proyecto JSON"
                onDragOver={event => {
                  if (!busy && !draftBusy) event.preventDefault();
                }}
                onDrop={event => {
                  event.preventDefault();
                  if (busy || draftBusy) return;
                  const files = event.dataTransfer?.files;
                  if (!files?.length) return;
                  if (files.length !== 1) {
                    setError('Arrastra un único archivo de proyecto JSON. Los proyectos múltiples no se pueden combinar.');
                    return;
                  }
                  // Reuse the same source fingerprint verification and explicit
                  // replacement confirmation as the file input above.
                  void openDraftFile(files[0]);
                }}
                className="rounded-lg border border-dashed border-indigo-300/30 bg-[var(--theme-panel)] px-3 py-2 text-xs text-[var(--theme-purple)]">
                O arrastra aquí un único proyecto JSON. Primero selecciona su grabación original.
                No se sube ningún archivo.
              </div>
            </div>
          </div>
        </section>
      )}
      </div>
      {audio && duration > 0 && (
        <section id="studio-turns" tabIndex={-1} className={`min-w-0 scroll-mt-6 rounded-2xl border border-[var(--border)] bg-[var(--theme-panel)] p-3 sm:p-4 ${workspaceActive ? 'space-y-2 lg:flex lg:h-[calc(100dvh-9rem)] lg:min-h-0 lg:flex-col lg:overflow-hidden' : 'space-y-3'}`}>
          {workspaceActive && (
            <StudioWorkspaceHeader stage={workspaceTab} onStageChange={setWorkspaceTab}
              onExit={() => setImmersiveMode(false)} exitRef={workspaceExit}/>
          )}
          {!workspaceActive && (
            <nav aria-label="Accesos rápidos del editor" className="flex flex-wrap gap-2">
              <a href="#studio-source" className="theme-action-secondary inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-xs font-semibold">Grabación</a>
              <a href={reviewCues.length ? '#studio-transcript-review' : '#studio-subtitles'} className="theme-action-secondary inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-xs font-semibold">Transcripción</a>
              {segments.length > 0 && <a href="#studio-export" className="theme-action-secondary inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-xs font-semibold">Ir a finalizar</a>}
            </nav>
          )}
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-lg font-bold text-[var(--foreground)]"><AudioLines size={20} /> Intervenciones ({segments.length}/{editorLimit})</h2>
            <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto">
              <input type="search" aria-label="Buscar intervenciones" value={segmentSearch}
                onChange={event => setSegmentSearch(event.currentTarget.value)}
                placeholder="Buscar cliente, hispanohablante o nota…"
                className="min-h-11 w-full min-w-0 rounded-lg sm:min-h-0 sm:w-48 border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] px-2 py-1.5 text-xs text-[var(--theme-control-text)] placeholder:text-[var(--text-tertiary)]"/>
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 sm:min-h-0 text-xs text-[var(--foreground)]">
                <input type="checkbox" checked={showPendingReview}
                  onChange={event => setShowPendingReview(event.currentTarget.checked)}
                  className="size-5 shrink-0 accent-[var(--theme-link)] sm:size-auto"/>
                {focusMode ? `Sin confirmar (${segments.length - confirmedIds.size})` : `Pendientes (${pendingReviewCount})`}
              </label>
              {visiblePendingTurns.length > 1 && (
                <button type="button" onClick={() => focusPendingTurn(-1)}
                  aria-label="Ir al pendiente anterior"
                  className="min-h-11 min-w-11 rounded-lg border sm:min-h-0 sm:min-w-0 border-cyan-400/30 px-3 py-1.5 text-xs font-semibold text-[var(--theme-info)] hover:bg-cyan-500/10">
                  Anterior pendiente
                </button>
              )}
              {visiblePendingTurns.length > 0 && (
                <button type="button" onClick={() => focusPendingTurn(1)}
                  aria-label="Ir al siguiente pendiente"
                  className="min-h-11 min-w-11 rounded-lg border sm:min-h-0 sm:min-w-0 border-cyan-400/30 px-3 py-1.5 text-xs font-semibold text-[var(--theme-info)] hover:bg-cyan-500/10">
                  Siguiente pendiente
                </button>
              )}
              <button type="button" onClick={() => {
                if (!focusMode && focusedTurn) setExpandedSegmentId(focusedTurn.segment.id);
                setFocusMode(previous => !previous);
                if (focusMode) setImmersiveMode(false);
              }}
                aria-pressed={focusMode}
                className="min-h-11 min-w-11 rounded-lg border sm:min-h-0 sm:min-w-0 border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--theme-link)]">
                {focusMode ? 'Volver a lista' : 'Modo enfoque'}
              </button>
              {!workspaceActive && (
                <button ref={workspaceEnter} type="button" onClick={() => {
                  if (focusedTurn) setExpandedSegmentId(focusedTurn.segment.id);
                  setFocusMode(true);
                  setWorkspaceTab('edit');
                  setImmersiveMode(true);
                }} className="theme-action-secondary min-h-11 min-w-11 rounded-lg sm:min-h-0 sm:min-w-0 px-3 py-1.5 text-xs font-semibold">
                  Abrir escritorio de edición
                </button>
              )}
              {!focusMode && (
                <button type="button" onClick={() => { preferenceEdits.current.compact = true; setCompactPreference(!compactRows); }}
                  aria-pressed={compactRows}
                  className="min-h-11 min-w-11 rounded-lg border sm:min-h-0 sm:min-w-0 border-[var(--border)] px-3 py-1.5 text-xs text-[var(--foreground)]">
                  {compactRows ? 'Vista detallada' : 'Vista compacta'}
                </button>
              )}
              {lastStructuralEdit && (
                <button type="button" onClick={undoLastStructuralEdit} disabled={busy || draftBusy || analyzingSilences}
                  aria-label={lastStructuralEdit.kind === 'exclusión'
                    ? 'Deshacer exclusión de intérpretes'
                    : lastStructuralEdit.kind === 'idiomas'
                      ? 'Deshacer asignación de idiomas'
                      : lastStructuralEdit.kind === 'hablantes'
                        ? 'Deshacer asignación de hablantes'
                      : lastStructuralEdit.kind === 'eliminación'
                        ? 'Deshacer eliminación de intervención'
                        : lastStructuralEdit.kind === 'adición VAD'
                          ? 'Deshacer adición de cortes VAD'
                          : lastStructuralEdit.kind === 'adición manual'
                            ? 'Deshacer adición manual'
                            : lastStructuralEdit.kind === 'importación de subtítulos'
                            ? 'Deshacer importación de subtítulos'
                            : lastStructuralEdit.kind === 'aplicación de pausas'
                              ? 'Deshacer aplicación de pausas'
                              : lastStructuralEdit.kind === 'apertura de proyecto'
                                ? 'Deshacer apertura de proyecto JSON'
                                : lastStructuralEdit.kind === 'ajuste de tiempos'
                                  ? 'Deshacer ajuste de tiempos'
                                  : lastStructuralEdit.kind === 'edición de intervención' ? 'Deshacer edición de intervención'
                                   : lastStructuralEdit.kind === 'recuperación de papelera' ? 'Deshacer recuperación de papelera'
                                   : 'Deshacer última división o unión'}
                  className="min-h-11 min-w-11 rounded-lg border sm:min-h-0 sm:min-w-0 border-amber-400/30 px-3 py-1.5 text-xs font-semibold text-[var(--theme-warning)] hover:bg-amber-400/10">
                  Deshacer {lastStructuralEdit.kind}
                </button>
              )}
              {nextStructuralEdit && <button type="button" onClick={redoLastStructuralEdit}
                disabled={busy || draftBusy || analyzingSilences} aria-label="Rehacer último cambio"
                className="theme-action-secondary min-h-11 min-w-11 rounded-lg sm:min-h-0 sm:min-w-0 px-3 py-1.5 text-xs font-semibold disabled:opacity-50">Rehacer {nextStructuralEdit.kind}</button>}
              {(history.past.length > 0 || history.future.length > 0) && <span className="text-xs text-[var(--text-secondary)]" title="Ctrl/Cmd+Z · Ctrl/Cmd+Shift+Z fuera de campos de texto">Historial: {history.past.length}/{STUDIO_HISTORY_LIMIT} · {history.future.length} para rehacer</span>}
              {!expandedEditor && <button type="button" onClick={() => { setExpandedEditor(true); setFocusMode(true); }}
                className="theme-action-secondary min-h-11 min-w-11 rounded-lg sm:min-h-0 sm:min-w-0 px-3 py-1.5 text-xs font-semibold">Ampliar editor a {STUDIO_MAX_EDITOR_SEGMENTS}</button>}
              {expandedEditor && <span className="text-xs text-[var(--text-secondary)]">Edición ampliada · publicación: {ROLEPLAY_MAX_SCENARIOS}</span>}
              <button type="button" onClick={addSegment} disabled={segments.length >= editorLimit}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg theme-action-primary sm:min-h-0 sm:w-auto px-3 py-1.5 text-sm font-semibold"><Plus size={16}/> Añadir fragmento</button>
            </div>
          </div>
          {segments.length > 0 && (
            <p role="status" aria-label="Resumen de revisión de intervenciones"
              className="text-xs text-[var(--text-secondary)]">
              Revisión de roles e idiomas: {reviewedCount}/{segments.length} sin pendientes ·
              {' '}{unidentifiedSpeakerCount} sin hablante · {unreviewedLanguageCount} con idioma por revisar
              {originalInterpreterCount > 0 &&
                <> · {originalInterpreterCount} del intérprete original por excluir</>}
            </p>
          )}
          {segments.length > 0 && (!workspaceActive || workspaceTab === 'edit') && (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <button type="button" aria-expanded={reviewCenterOpen} aria-controls="studio-review-center"
                onClick={() => { setReviewCenterOpen(previous => !previous); setTrashOpen(false); }}
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--theme-link)]">
                Centro de revisión ({issueTurns.length})
              </button>
              <span className="text-xs text-[var(--text-secondary)]">{issueTurns.length} con incidencias · {readyUnconfirmedCount} listas para confirmar</span>
              {issueTurns.length > 0 && <button type="button" onClick={() => openReviewEntry(issueTurns[0].turn.id)}
                className="theme-action-secondary rounded-lg px-3 py-2 text-xs font-semibold">Ir a primera incidencia</button>}
            </div>
          )}
          {focusMode && (segments.length > 0 || excludedTurns.length > 0) && (!workspaceActive || workspaceTab === 'edit') && (
            <button type="button" aria-expanded={timelineOpen} aria-controls="studio-focused-timeline"
              onClick={() => setTimelineOpen(previous => !previous)}
              className="shrink-0 self-start rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--theme-link)]">
              {timelineOpen ? 'Ocultar línea de tiempo' : 'Mostrar línea de tiempo'}
            </button>
          )}
          {workspaceActive && recoveryStatus && <p role="status" className="shrink-0 text-xs text-[var(--text-secondary)]">{recoveryStatus}</p>}
          {excludedTurns.length > 0 && (!workspaceActive || workspaceTab === 'edit') && (
            <button type="button" aria-expanded={trashOpen} aria-controls="studio-editorial-trash" onClick={() => { setTrashOpen(previous => !previous); setReviewCenterOpen(false); }}
              className="shrink-0 self-start rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--theme-link)]">Papelera editorial ({excludedTurns.length})</button>
          )}
          {focusMode && segments.length > 0 && (!workspaceActive || workspaceTab === 'edit') && (
            <p role="status" aria-label="Confirmaciones editoriales" className="shrink-0 text-xs text-[var(--text-secondary)]">
              {confirmedIds.size}/{segments.length} intervenciones confirmadas en esta sesión. Los cambios requieren nueva revisión.
            </p>
          )}
          {focusMode && focusedTurn && (!workspaceActive || workspaceTab === 'edit') && (
            <StudioFocusNavigation visibleSegments={visibleSegments} focusedTurn={focusedTurn}
              focusIndex={focusIndex} totalTurns={segments.length} workspaceActive={workspaceActive}
              canConfirmFocused={canConfirmFocused} editingDisabled={busy || draftBusy || analyzingSilences}
              confirmed={confirmedIds.has(focusedTurn.segment.id)} focusedReviewIssue={focusedReviewIssue}
              sourceProfileCount={sourceProfileCount}
              previewActive={previewingId === focusedTurn.segment.id || pairPreviewId === focusedTurn.segment.id}
              playhead={playhead} duration={duration}
              onFocusCard={() => focusStudioIntervention(focusedTurn.segment.id, !workspaceActive)}
              onSelect={selectFocusedTurn} onConfirm={confirmAndAdvance}
              onExclude={() => removeIntervention(focusedTurn.segment.id, true)}
              onApplyProfile={() => applySourceSpeakerProfile(focusedTurn.segment.id)}
              onPreview={() => previewSegment(focusedTurn.segment)}
              onPause={() => { stopPreview(); stopPairPreview(); }}
              onSkip={seconds => seekAudio((player.current?.currentTime ?? playhead) + seconds)}
              onSeek={seekAudio}
            />
          )}
          <div ref={workspaceContent} className={workspaceActive ? 'min-h-0 space-y-3 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain lg:pr-1' : 'space-y-3'}>
          {workspaceActive && error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-[var(--theme-danger)]">{error}</p>}
          {workspaceActive && notice && <p role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-[var(--theme-success)]">{notice}</p>}
          <div hidden={workspaceActive && workspaceTab !== 'edit'} className="space-y-3">
          {focusMode && timelineOpen && (segments.length > 0 || excludedTurns.length > 0) && (
            <div id="studio-focused-timeline">
              <FocusTimeline duration={duration} playhead={playhead} active={segments}
                excluded={excludedTimelineTurns} selectedId={focusedTurn?.segment.id}
                onSeek={seconds => { stopPreview(); stopPairPreview(); seekAudio(seconds); }}
                onSelect={(id, excluded) => {
                  if (excluded) {
                    setTrashOpen(true);
                    setReviewCenterOpen(false);
                    setNotice('Corte excluido localizado. Continúa en la papelera para recuperarlo si lo necesitas.');
                  } else {
                    setTrashOpen(false);
                    setReviewCenterOpen(false);
                    setSegmentSearch('');
                    setShowPendingReview(false);
                    selectFocusedTurn(id);
                  }
                }}/>
            </div>
          )}
          {reviewCenterOpen && segments.length > 0 && (
            <section id="studio-review-center" aria-label="Centro de revisión editorial" className="space-y-2 rounded-lg border border-[var(--border)] p-3">
              <h3 className="text-sm font-semibold text-[var(--foreground)]">Incidencias de todo el proyecto</h3>
              <p className="text-xs text-[var(--text-secondary)]">Incluye intervenciones ocultas por búsqueda o filtros. No modifica los cortes ni confirma automáticamente las voces.</p>
              <label className="block text-xs text-[var(--text-secondary)]">Tipo de incidencia
                <select value={reviewCategory} onChange={event => setReviewCategory(event.currentTarget.value as typeof reviewCategory)}
                  className="mt-1 block w-full rounded-lg border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] p-2 text-[var(--theme-control-text)]">
                  <option value="all">Todas las incidencias ({issueTurns.length})</option>
                  {reviewCategories.map(category => <option key={category.code} value={category.code}>{category.label} ({issueTurns.filter(item => item.findings.some(finding => finding.code === category.code)).length})</option>)}
                  <option value="unconfirmed">Listas para confirmar ({readyUnconfirmedCount})</option>
                </select>
              </label>
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {reviewEntries.length === 0 && <p className="text-xs text-[var(--text-secondary)]">No hay intervenciones en esta categoría.</p>}
                {reviewEntries.map(entry => <div key={entry.turn.id} className="rounded-md border border-[var(--border)] p-2">
                  <button type="button" onClick={() => openReviewEntry(entry.turn.id)}
                    aria-label={'Revisar intervención ' + entry.number}
                    className="w-full break-words text-left text-sm font-semibold text-[var(--theme-link)]">
                    #{entry.number} · {entry.turn.title}
                  </button>
                  <p className="text-xs text-[var(--text-secondary)]">{formatTime(entry.turn.start)}–{formatTime(entry.turn.end)}</p>
                  {entry.findings.length ? <ul className="list-disc pl-4 text-xs text-[var(--theme-warning)]">
                    {entry.findings.map(finding => <li key={finding.code}>{finding.message}</li>)}
                  </ul> : <p className="text-xs text-[var(--text-secondary)]">Sin incidencias detectadas; requiere revisión humana.</p>}
                </div>)}
              </div>
            </section>
          )}
          {trashOpen && excludedTurns.length > 0 && <section id="studio-editorial-trash" aria-label="Intervenciones excluidas" className="space-y-2 rounded-lg border border-[var(--border)] p-3">
            <h3 className="text-sm font-semibold text-[var(--foreground)]">Intervenciones excluidas</h3>
            <p className="text-xs text-[var(--text-secondary)]">No forman parte del roleplay publicable. Recupera un corte si es compatible con los tiempos actuales. El respaldo local opcional conserva la papelera (hasta 100 cortes) sin referencias privadas. Si un corte es inválido o el respaldo supera su tamaño máximo, se conserva el último respaldo válido.</p>
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {excludedTurns.map(({ turn }) => {
                const issue = restoreExcludedIssue(turn, segments, duration, editorLimit);
                return <div key={turn.id} className="rounded-md border border-[var(--border)] p-2">
                  <p className="break-words text-sm font-medium text-[var(--foreground)]">{turn.title}</p>
                  <p className="text-xs text-[var(--text-secondary)]">{formatTime(turn.start)}–{formatTime(turn.end)} · {turn.language.toUpperCase()}</p>
                  {issue && <p className="text-xs text-[var(--theme-warning)]">{issue}</p>}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" disabled={Boolean(issue) || busy || draftBusy || analyzingSilences} onClick={() => restoreExcluded(turn.id)}
                      aria-label={'Recuperar ' + turn.title} className="theme-action-secondary rounded-lg px-3 py-2 text-xs disabled:opacity-50">Recuperar</button>
                    <button type="button" disabled={busy || draftBusy || analyzingSilences} onClick={() => discardExcluded(turn.id)}
                      aria-label={'Eliminar definitivamente ' + turn.title} className="rounded-lg px-3 py-2 text-xs text-[var(--theme-danger)]">Eliminar definitivamente</button>
                  </div>
                </div>;
              })}
            </div>
          </section>}
          {pendingSpeakerIds.length > 1 && (
            <section aria-label="Clasificación rápida de perfiles" className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--theme-surface-muted)] p-3">
              <h3 className="text-sm font-semibold text-[var(--foreground)]">Clasificación rápida</h3>
              <div className="flex flex-wrap items-center gap-2">
              <span className="mr-auto text-xs text-[var(--text-secondary)]">
                {pendingSpeakerIds.length} intervenciones visibles sin hablante. Se respetarán los perfiles revisados y los filtros actuales.
              </span>
              <button type="button" disabled={!pendingClientIds.length} onClick={() => setSpeakerForPendingTurns('doctor', pendingClientIds)}
                className="theme-action-secondary min-h-11 rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50">
                Cliente · EN ({pendingClientIds.length})
              </button>
              <button type="button" disabled={!pendingSpanishIds.length} onClick={() => setSpeakerForPendingTurns('patient', pendingSpanishIds)}
                className="theme-action-secondary min-h-11 rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50">
                Hispanohablante · ES ({pendingSpanishIds.length})
              </button>
              </div>
              <p className="text-xs text-[var(--text-secondary)]">Solo se asignan turnos sin perfil e idioma compatible. Clasifica al intérprete original individualmente para evitar exclusiones accidentales.</p>
            </section>
          )}
          {(profileLanguagePendingIds.length > 0 || pendingLanguageIds.length > 1) && (
            <section aria-label="Idiomas pendientes" className="space-y-2 rounded-lg border border-[var(--border)] p-3">
              <h3 className="text-sm font-semibold text-[var(--foreground)]">Completar idiomas pendientes</h3>
              <p className="text-xs text-[var(--text-secondary)]">Completa solo idiomas desconocidos. Los idiomas incompatibles requieren escuchar el fragmento y corregir su perfil individualmente.</p>
            {profileLanguagePendingIds.length > 0 && (
              <button type="button" onClick={() => applyProfileLanguagePattern(profileLanguagePendingIds)}
                className="rounded-lg theme-action-primary px-3 py-2 text-xs font-semibold">
                Completar cliente EN / hispanohablante ES ({profileLanguagePendingIds.length} pendientes visibles)
              </button>
            )}
          {pendingLanguageIds.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--theme-surface-muted)] px-3 py-2">
              <span className="mr-auto text-xs text-[var(--text-secondary)]">
                {pendingLanguageIds.length} intervenciones visibles sin idioma ni perfil. Solo se cambiarán las que aparecen con los filtros actuales.
              </span>
              <button type="button" onClick={() => setLanguageForPendingTurns('en', pendingLanguageIds)}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--theme-link)] hover:bg-blue-500/10">
                Marcar pendientes como inglés
              </button>
              <button type="button" onClick={() => setLanguageForPendingTurns('es', pendingLanguageIds)}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--theme-link)] hover:bg-blue-500/10">
                Marcar pendientes como español
              </button>
            </div>
          )}

            </section>
          )}
          <details className="space-y-3 rounded-lg border border-teal-400/20 bg-teal-400/5 p-3">
            <summary className="cursor-pointer text-sm font-semibold text-[var(--theme-info)]">
              Protocolos de interpretación consecutiva (opcional)
            </summary>
            <p className="text-xs leading-5 text-[var(--text-secondary)]">
              Plantillas opcionales de apertura, petición de repetición y cierre.
              Solo se insertan en las instrucciones de la intervención que elijas;
              no crean audios ni respuestas modelo. El participante podrá leerlas al abrir «Ver guión».
              Evita incluirlas en evaluaciones sin ayuda si revelarían la respuesta.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-[var(--foreground)]">Protocolo
                <select value={protocolKind}
                  onChange={event => setProtocolKind(event.currentTarget.value as StudioProtocolKind)}
                  className="mt-1 w-full rounded-lg border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] p-2 text-[var(--theme-control-text)]">
                  <option value="opening">Apertura</option>
                  <option value="repetition">Pedir repetición / aclaración</option>
                  <option value="closing">Cierre</option>
                </select>
              </label>
              <label className="text-sm text-[var(--foreground)]">Idioma del protocolo
                <select value={protocolLanguage}
                  onChange={event => { preferenceEdits.current.protocolLanguage = true; setProtocolLanguage(event.currentTarget.value as StudioProtocolLanguage); }}
                  className="mt-1 w-full rounded-lg border border-[var(--theme-control-border)] bg-[var(--theme-control-bg)] p-2 text-[var(--theme-control-text)]">
                  <option value="en">Inglés</option>
                  <option value="es">Español</option>
                </select>
              </label>
            </div>
          </details>
          <details className="space-y-3 rounded-lg border border-[var(--border)] p-2">
            <summary className="cursor-pointer text-sm font-semibold text-[var(--foreground)]">Guía de interpretación y ayuda de clasificación</summary>
          <section aria-label="Flujo de interpretación médica" className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--theme-surface-muted)] p-3">
            <div>
              <h3 className="text-sm font-semibold text-[var(--foreground)]">Flujo médico bilingüe</h3>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">El participante inicia con el protocolo en ambos idiomas. Conserva las voces del médico y paciente; el nuevo intérprete realiza las traducciones.</p>
            </div>
            <ol className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-5">
              {[
                ['Apertura · EN + ES', 'Intérprete participante'],
                ['Médico · EN', 'Conservar audio'],
                ['Interpretación · ES', 'Respuesta del participante'],
                ['Paciente · ES', 'Conservar audio'],
                ['Interpretación · EN', 'Respuesta del participante'],
              ].map(([title, detail]) => (
                <li key={title} className="rounded-lg border border-[var(--border)] bg-[var(--theme-panel)] p-2">
                  <span className="block font-semibold text-[var(--foreground)]">{title}</span>
                  <span className="mt-1 block text-[var(--text-secondary)]">{detail}</span>
                </li>
              ))}
            </ol>
            <p className="text-xs text-[var(--text-secondary)]">Repite el ciclo según la grabación. Excluye las traducciones y la apertura del intérprete original; no se identifica una voz por su posición en la secuencia.</p>

          </section>
          </details>
          {originalInterpreterCount > 0 && (
            <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-xs text-[var(--theme-warning)]">
              <p>
                {originalInterpreterCount} {originalInterpreterCount === 1 ? 'turno identificado' : 'turnos identificados'}
                {' '}como intérprete original. Excluye esos fragmentos antes de exportar el roleplay.
              </p>
              <button type="button" onClick={excludeOriginalInterpreterTurns}
                className="rounded-lg border border-amber-300/40 px-3 py-2 font-semibold text-[var(--theme-warning)] hover:bg-amber-400/10">
                Excluir {originalInterpreterCount} {originalInterpreterCount === 1 ? 'intervención' : 'intervenciones'} del intérprete
              </button>
            </div>
          )}
          {segments.length > 0 && (
            <p className="text-xs text-[var(--text-secondary)]">
              Cursor: <span className="font-medium text-[var(--theme-info)]">{formatTime(playhead)}</span>.
              {' '}«Dividir» corta en el cursor cuando está dentro del turno; fuera de él usa el punto medio.
              {' '}«Unir» combina turnos compatibles. Si están separados por más de 2 s,
              crea un único MP3 sin la pausa al exportar localmente el proyecto v2.
            </p>
          )}
          {segments.length === 0 && <p className="text-sm text-[var(--text-secondary)]">Añade una intervención, define inicio y final en segundos y comprueba su título.</p>}
          {segments.length > 0 && visibleSegments.length === 0 && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--text-secondary)]">
              <span>{showPendingReview && focusMode && confirmedIds.size === segments.length
                ? 'Todas las intervenciones están confirmadas en esta sesión.'
                : showPendingReview && !focusMode && pendingReviewCount === 0
                  ? 'Todas las intervenciones tienen hablante e idioma revisados.'
                  : 'No hay intervenciones que coincidan con los filtros.'}</span>
              {(showPendingReview || segmentSearch) && (
                <button type="button" onClick={() => { setShowPendingReview(false); setSegmentSearch(''); }}
                  className="rounded-md border border-[var(--border)] px-2 py-1 text-[var(--theme-link)]">Limpiar filtros</button>
              )}
            </div>
          )}
          {!focusMode && segments.length >= 6 && (
            <p className="text-xs text-[var(--text-secondary)]">
              {visibleSegments.length} de {segments.length} turnos. Identifica hablante e idioma
              en la fila compacta; abre «Editar» para ajustar tiempos e instrucciones.
            </p>
          )}
          {renderedSegments.map(({ segment, index }) => {
            const nextTurn = orderedSegments[index + 1];
            return <StudioInterventionCard key={segment.id} segment={segment} index={index}
              nextTurn={nextTurn} canPreviewPair={previewablePairIds.has(segment.id)}
              caption={captionTexts[segment.id]} compactRows={compactRows} focusMode={focusMode}
              expandedSegmentId={expandedSegmentId === segment.id ? segment.id : null}
              advancedTurnId={advancedTurnId === segment.id ? segment.id : null}
              turnActionFeedback={turnActionFeedback?.id === segment.id ? turnActionFeedback : null}
              boundaryProposal={focusedTurn?.segment.id === segment.id ? boundaryProposal : null}
              canUseBoundaryProposal={focusedTurn?.segment.id === segment.id && canUseBoundaryProposal}
              proposalPreviewId={focusedTurn?.segment.id === segment.id ? proposalPreviewId : ''}
              previewingId={previewingId === segment.id ||
                (focusedTurn?.segment.id === segment.id && previewingId === proposalPreviewId) ? previewingId : null}
              pairPreviewId={pairPreviewId === segment.id ? segment.id : null} duration={duration}
              {...cardActions}
            />;
          })}
          </div>
          <div hidden={workspaceActive && workspaceTab !== 'finish'} className="space-y-3">
          {!workspaceActive && segments.length > 0 && <nav aria-label="Volver a edición" className="flex flex-wrap gap-2">
            <a href="#studio-turns" className="theme-action-secondary inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-xs font-semibold">Volver a intervenciones</a>
          </nav>}
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
            <p className="text-xs text-[var(--theme-warning)]">
              El simulador consecutivo de intervalos continuos está deshabilitado para proyectos compuestos.
              Utiliza «Escuchar unido» para revisar cada unión física antes de generar el ZIP local.
            </p>
          )}
          {!workspaceActive && error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-[var(--theme-danger)]">{error}</p>}
          {!workspaceActive && notice && <p role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-[var(--theme-success)]">{notice}</p>}
          {segments.length > 0 && <StudioTopicPicker value={editorialTopic} onChange={setEditorialTopic} disabled={busy || draftBusy || analyzingSilences}/>}
          <StudioFinalizationPanel
            segmentCount={segments.length} expandedEditor={expandedEditor}
            publicationPlan={publicationPlan} currentWavPlan={currentWavPlan} selectedPublicationPart={selectedPublicationPart}
            hasAudio={Boolean(audio)} duration={duration} sourceRequiresLocal={sourceRequiresLocal} hasCompound={hasCompound}
            allowServerZipExport={allowServerZipExport} localOnly={localOnly} wavSource={wavSource}
            localMp3Eligible={localMp3Eligible} convertedMp3Bytes={convertedMp3 && convertedMp3.original === audio ? convertedMp3.wav.size : null}
            busy={busy} draftBusy={draftBusy} analyzingSilences={analyzingSilences}
            activeProductionKeys={activeProductionKeys} readyAssignment={readyAssignment ? { token: readyAssignment.token, partKey: readyAssignment.partKey } : null}
            onSelectPart={setPublicationPartKey} onSaveDraft={() => void saveDraft()}
            onDownloadPart={() => { if (selectedPublicationPart) void exportPackage(selectedPublicationPart); }}
            onChangeMode={mode => {
              subtitleImportRevision.current += 1;
              draftOperationRevision.current += 1;
              exportRevision.current += 1;
              exportAbort.current?.abort();
              exportAbort.current = null;
              setBusy(false);
              setDraftBusy(false);
              setAllowServerZipExport(mode === 'server');
              setError('');
              setNotice(mode === 'server' ? 'Modo servidor seleccionado: al exportar, el MP3 se enviará para generar el ZIP.' : 'Modo local: prepara los cortes en el navegador si el formato es compatible o guarda el JSON para usar el exportador de escritorio.');
            }}
            onReleaseMp3={releaseLocalMp3} onEnableMp3={() => void enableLocalMp3()}
            onPrepareLocal={() => void prepareLocalAssignment(currentWavPlan && currentWavPlan.parts.length > 1 ? selectedPublicationPart : undefined)}
            onPrepareServer={() => void exportPackage(undefined, 'assignment')}
            onDownload={() => void exportPackage()}
            onConfirmNavigation={confirmEditorNavigation}
                  onContinue={event => {
                    if (!readyAssignment) { event.preventDefault(); return; }
                    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) {
                      event.preventDefault(); setError('Continúa en esta misma pestaña para conservar el paquete temporal.'); return;
                    }
                    if (readyAssignment.revision !== subtitleImportRevision.current || busy || draftBusy || !confirmEditorNavigation()) {
                      event.preventDefault(); return;
                    }
                    const key = activeProductionKeys?.get(readyAssignment.partKey ?? publicationPlan.parts[0]?.key ?? '');
                    const status = key ? productionStatus(key) : undefined;
                    if ((status === 'created' || status === 'unconfirmed') && !window.confirm('Esta parte ya tiene una creación confirmada o un intento sin confirmar en esta pestaña. Consulta las sesiones existentes para evitar duplicados. ¿Continuar de todos modos?')) {
                      event.preventDefault(); return;
                    }
                    try {
                      const backup = recoveryEnabled ? flushRecovery.current?.() : undefined;
                      if (recoveryEnabled && !backup && !window.confirm('No se pudo actualizar el respaldo local. La producción quedará registrada solo en esta pestaña. ¿Continuar?')) {
                        event.preventDefault(); return;
                      }
                      const selection = parseEditorialRoleplayTopic(editorialTopic.topic, editorialTopic.subtopic);
                      if (readyAssignment.files) stageLocalWavHandoff(readyAssignment.token, readyAssignment.files, selection);
                      else stageStudioHandoff(readyAssignment.token, readyAssignment.file, selection);
                      if (key) trackProductionTransfer(readyAssignment.token, key, backup);
                    }
                    catch (cause) { event.preventDefault(); setError(cause instanceof Error ? cause.message : 'No se pudo transferir el paquete.'); }
                  }}
          />
          </div>
          </div>
        </section>
      )}
      {error && (!audio || !duration) && <p role="alert" className="text-sm text-[var(--theme-danger)]">{error}</p>}
      {notice && (!audio || !duration) && (
        <p role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-[var(--theme-success)]">
          {notice}
        </p>
      )}
      <p hidden={workspaceActive} className="text-xs leading-5 text-[var(--text-tertiary)]">
        Solo administración · Los archivos originales locales no se guardan en la biblioteca.
        Verifica consentimiento y ausencia de datos médicos identificables antes de publicar.
      </p>
    </main>
  );
}
