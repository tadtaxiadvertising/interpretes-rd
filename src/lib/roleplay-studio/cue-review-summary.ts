import { classifySpeakerRole } from './speaker-profiles';
import type { TimedTranscriptCue } from './transcript';
import type { LocalVadSnapshot } from './local-vad';

/**
 * Read-only, local metadata for the SRT review. These counts never infer
 * actual voices/languages and never include or transmit transcript text.
 */
export type TimedCueReviewSummary = {
  unknownSpeakers: number;
  originalInterpreters: number;
  longCues: number;
  sourceThirds: number | null;
};

/**
 * Identify both sides of every overlapping pair among *selected* SRT cues.
 * Input may contain duplicate or invalid indexes while an administrator is
 * editing. This is a read-only review hint, never a correction to timestamps,
 * speaker identity or the chosen selection.
 *
 * At most 25 items are selected for a roleplay, so inspecting the ordered
 * intervals is cheap even when the source contains thousands of captions.
 */
export function overlappingSelectedTimedCueIndices(
  cues: readonly TimedTranscriptCue[],
  indices: readonly number[],
): number[] {
  const selected = [...new Set(indices)]
    .filter(index => Number.isSafeInteger(index) && index >= 0 && index < cues.length)
    .filter(index => {
      const cue = cues[index];
      return Number.isFinite(cue.start) && Number.isFinite(cue.end) &&
        cue.start >= 0 && cue.end > cue.start;
    })
    .sort((left, right) => cues[left].start - cues[right].start ||
      cues[left].end - cues[right].end || left - right);
  const overlaps = new Set<number>();

  for (let i = 0; i < selected.length; i++) {
    const left = selected[i];
    for (let j = i + 1; j < selected.length; j++) {
      const right = selected[j];
      // End == start is a valid adjacent pair, not an overlap.
      if (cues[right].start >= cues[left].end) break;
      overlaps.add(left);
      overlaps.add(right);
    }
  }
  return [...overlaps].sort((a, b) => a - b);
}

/** Exact selected conflicts for one candidate; adjacent endpoints are compatible. */
export function conflictingSelectedTimedCueIndices(
  cues: readonly TimedTranscriptCue[],
  indices: readonly number[],
  candidateIndex: number,
): number[] {
  const valid = (index: number) => {
    if (!Number.isSafeInteger(index) || index < 0 || index >= cues.length) return false;
    const cue = cues[index];
    return Number.isFinite(cue.start) && Number.isFinite(cue.end) &&
      cue.start >= 0 && cue.end > cue.start;
  };
  if (!valid(candidateIndex)) return [];
  const candidate = cues[candidateIndex];
  return [...new Set(indices)]
    .filter(index => index !== candidateIndex && valid(index))
    .filter(index => candidate.start < cues[index].end && cues[index].start < candidate.end)
    .sort((a, b) => a - b);
}

/**
 * Conservative timing-only suggestion: trim a single edge against one
 * selected neighbor. Never infer a word boundary or resolve containment.
 * The caller must let the editor listen and explicitly accept the change.
 */
export function proposeSelectedCueEdgeTrim(
  cues: readonly TimedTranscriptCue[], indices: readonly number[], index: number,
  duration: number,
): { start: number; end: number } | null {
  if (!indices.includes(index) || !Number.isFinite(duration) || duration <= 0) return null;
  const conflicts = conflictingSelectedTimedCueIndices(cues, indices, index);
  if (conflicts.length !== 1) return null;
  const cue = cues[index];
  const other = cues[conflicts[0]];
  if (cue.end > duration || other.end > duration) return null;
  let { start, end } = cue;
  if (other.start < start && other.end < end) start = other.end;
  else if (other.start > start && other.end > end) end = other.start;
  else return null;
  const trimmed = (start - cue.start) + (cue.end - end);
  if (trimmed <= 0 || trimmed > 0.5 + 1e-9 || end - start < 0.5 - 1e-9) return null;
  return { start, end };
}

/** Return the single edge removed by a conservative trim, without changing either cue. */
export function removedCueEdge(
  cue: Pick<TimedTranscriptCue, 'start' | 'end'>,
  proposal: Pick<TimedTranscriptCue, 'start' | 'end'>,
): { start: number; end: number } | null {
  if (![cue.start, cue.end, proposal.start, proposal.end].every(Number.isFinite) ||
      cue.start < 0 || proposal.start < cue.start || proposal.end > cue.end ||
      proposal.end <= proposal.start) return null;
  if (proposal.start > cue.start && proposal.end === cue.end) {
    return { start: cue.start, end: proposal.start };
  }
  if (proposal.start === cue.start && proposal.end < cue.end) {
    return { start: proposal.end, end: cue.end };
  }
  return null;
}

export type CueTrimActivityHint = 'detected' | 'not-detected' | 'unavailable';

/**
 * Advisory only: padded VAD regions can contain silence, and missing regions
 * may hide quiet speech, short events or activity beyond the detector cap.
 * Never treat a negative result as evidence of a safe word boundary.
 */
export function cueTrimActivityHint(
  cue: Pick<TimedTranscriptCue, 'start' | 'end'>,
  proposal: Pick<TimedTranscriptCue, 'start' | 'end'>,
  snapshot: LocalVadSnapshot | null,
): CueTrimActivityHint {
  if (snapshot?.status !== 'ready' ||
      ![cue.start, cue.end, proposal.start, proposal.end].every(Number.isFinite) ||
      cue.start < 0 || proposal.start < cue.start || proposal.end > cue.end ||
      proposal.end <= proposal.start ||
      (proposal.start === cue.start && proposal.end === cue.end) ||
      snapshot.segments.some(region => !Number.isFinite(region.start) ||
        !Number.isFinite(region.end) || region.start < 0 || region.end <= region.start)) {
    return 'unavailable';
  }
  const removed = [
    { start: cue.start, end: proposal.start },
    { start: proposal.end, end: cue.end },
  ].filter(range => range.end > range.start);
  if (snapshot.segments.some(region => removed.some(range =>
    range.start < region.end && region.start < range.end))) return 'detected';
  // The detector caps its output at 100 regions; do not imply coverage of
  // the remaining audio or of an empty result.
  if (snapshot.segments.length === 0 || snapshot.segments.length >= 100) return 'unavailable';
  return 'not-detected';
}

/** Identify candidate turns requiring an operator's attention, without inferring voices. */
export function cueRequiresEditorialReview(cue: TimedTranscriptCue): boolean {
  const role = classifySpeakerRole(cue.speaker);
  return role === 'unknown' || role === 'interpreter' ||
    (Number.isFinite(cue.start) && Number.isFinite(cue.end) &&
      cue.end - cue.start > 60);
}

export function summarizeTimedCueReview(
  cues: readonly TimedTranscriptCue[],
  indices: readonly number[],
  sourceDurationSeconds: number,
): TimedCueReviewSummary {
  const validDuration = Number.isFinite(sourceDurationSeconds) && sourceDurationSeconds >= 180;
  const thirds = new Set<number>();
  let unknownSpeakers = 0;
  let originalInterpreters = 0;
  let longCues = 0;

  for (const index of new Set(indices)) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= cues.length) continue;
    const cue = cues[index];
    const role = classifySpeakerRole(cue.speaker);
    if (role === 'unknown') unknownSpeakers++;
    if (role === 'interpreter') originalInterpreters++;
    if (Number.isFinite(cue.start) && Number.isFinite(cue.end) &&
        cue.end - cue.start > 60) longCues++;
    if (validDuration && Number.isFinite(cue.start) &&
        cue.start >= 0 && cue.start <= sourceDurationSeconds) {
      thirds.add(Math.min(2, Math.floor(3 * cue.start / sourceDurationSeconds)));
    }
  }

  return {
    unknownSpeakers,
    originalInterpreters,
    longCues,
    sourceThirds: validDuration ? thirds.size : null,
  };
}
