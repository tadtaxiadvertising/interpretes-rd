import { classifySpeakerRole } from './speaker-profiles';
import type { TimedTranscriptCue } from './transcript';

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
