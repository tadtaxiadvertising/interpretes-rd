'use client';

import { useRef, useState } from 'react';
import { emptyStudioHistory, rememberStudioEdit, stepStudioHistory, mapStudioHistory } from '@/lib/roleplay-studio/editorial-history';
import type { TimedTranscriptCue } from '@/lib/roleplay-studio/transcript';
import type { StudioSilence, StudioSuggestedClip } from '@/lib/roleplay-studio/silence-analysis';
import type { StudioIntervention as Segment } from './StudioInterventionCard';

export type EditorialSnapshot = {
    kind: 'edición de intervención' | 'recuperación de papelera' | 'ajuste de tiempos' | 'división' | 'unión' | 'separación' | 'exclusión' | 'idiomas' | 'hablantes' | 'eliminación' | 'adición manual' | 'adición VAD' | 'importación de subtítulos' | 'aplicación de pausas' | 'apertura de proyecto';
    segments: Segment[];
    captions: Record<string, string>;
    expandedId: string | null;
    previousSuggestions?: {
      silences: StudioSilence[];
      clips: StudioSuggestedClip[];
      omittedCount: number;
    };
    previousReview?: {
      cues: TimedTranscriptCue[];
      selected: number[];
      page: number;
      search: string;
      selectedOnly: boolean;
      alertsOnly: boolean;
      segmentSearch: string;
      pendingOnly: boolean;
    };
    excluded?: Array<{ turn: Segment; caption?: string }>;
    confirmations?: ReadonlyMap<string, Segment>;
};

export function hasRecoverableUndo(edit: EditorialSnapshot | null) {
  return Boolean(edit && (edit.segments.length > 0 ||
    Object.keys(edit.captions).length > 0 || (edit.excluded?.length ?? 0) > 0 ||
    (edit.previousReview?.cues.length ?? 0) > 0 ||
    (edit.previousSuggestions?.clips.length ?? 0) > 0 ||
    (edit.previousSuggestions?.silences.length ?? 0) > 0));
}

/** In-memory metadata only. The editor still applies snapshots, checks busy
 * guards, stops audio, and invalidates prepared packages before restoration. */
export function useStudioEditorialHistory(excluded: Array<{turn: Segment; caption?: string}>, confirmations: ReadonlyMap<string, Segment>) {
  const [history, setHistory] = useState(() => emptyStudioHistory<EditorialSnapshot>());
  const editGroup = useRef<{key: string; at: number} | null>(null);
  const endEditGroup = () => { editGroup.current = null; };
  const clearEditorialHistory = () => {
    endEditGroup();
    setHistory(emptyStudioHistory());
  };
  const rememberEdit = (snapshot: EditorialSnapshot) => {
    endEditGroup();
    const before = {...snapshot, excluded, confirmations};
    setHistory(previous => rememberStudioEdit(previous, before));
  };
  const rememberGroupedEdit = (key: string, snapshot: EditorialSnapshot, at = Date.now()) => {
    const previous = editGroup.current;
    if (!previous || previous.key !== key || at - previous.at > 750 || at < previous.at) rememberEdit(snapshot);
    editGroup.current = {key, at};
  };
  const stepHistory = (current: EditorialSnapshot, direction: 'undo' | 'redo') => {
    endEditGroup();
    setHistory(previous => stepStudioHistory(previous, current, direction));
  };
  const forgetServerSuggestions = () => {
    endEditGroup();
    setHistory(previous => mapStudioHistory(previous, snapshot => snapshot.previousSuggestions
      ? {...snapshot, previousSuggestions: undefined} : snapshot));
  };
  return {
    history, lastStructuralEdit: history.past.at(-1) ?? null, nextStructuralEdit: history.future.at(-1) ?? null,
    clearEditorialHistory, rememberEdit, rememberGroupedEdit, endEditGroup, stepHistory, forgetServerSuggestions,
  };
}
