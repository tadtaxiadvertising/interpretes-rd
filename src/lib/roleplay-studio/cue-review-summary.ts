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
