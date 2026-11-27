'use client';

import { useLayoutEffect, useMemo, useRef } from 'react';
import type { StudioCardActions } from './StudioInterventionCard';

/** Card actions run from user events, using the latest committed editor state.
 * Updating the ref after commit avoids exposing a discarded render's closures.
 */
export function useStudioCardActions(actions: StudioCardActions): StudioCardActions {
  const latest = useRef(actions);
  useLayoutEffect(() => { latest.current = actions; }, [actions]);
  return useMemo<StudioCardActions>(() => ({
    seekAudio: seconds => latest.current.seekAudio(seconds),
    splitAtPlayhead: id => latest.current.splitAtPlayhead(id),
    mergeWithNext: id => latest.current.mergeWithNext(id),
    separateCompound: id => latest.current.separateCompound(id),
    previewPairWithoutGap: id => latest.current.previewPairWithoutGap(id),
    previewSegment: segment => latest.current.previewSegment(segment),
    removeIntervention: id => latest.current.removeIntervention(id),
    update: (id, patch) => latest.current.update(id, patch),
    insertProtocol: segment => latest.current.insertProtocol(segment),
    markAtPlayhead: (id, boundary) => latest.current.markAtPlayhead(id, boundary),
    applyBoundaryProposal: () => latest.current.applyBoundaryProposal(),
    onToggleExpanded: id => latest.current.onToggleExpanded(id),
    onToggleAdvanced: id => latest.current.onToggleAdvanced(id),
  }), []);
}
