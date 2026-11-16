/**
 * Choose a non-overlapping 30-second (at most) insertion window on the source
 * timeline, preferring the current playhead and then the next available gap.
 *
 * Rounding the start UP and the end DOWN to hundredths prevents a cue with
 * millisecond precision from expanding into an adjacent occupied interval.
 */
export interface OccupiedStudioInterval { start: number; end: number }

const MIN_CUT_SECONDS = 0.1;
const DEFAULT_CUT_SECONDS = 30;
const HUNDREDTH = 100;
const TOLERANCE = 1e-8;

export function availableStudioInterval(
  duration: number,
  playhead: number,
  segments: readonly OccupiedStudioInterval[],
): { start: number; end: number } | null {
  if (!Number.isFinite(duration) || duration <= 0) return null;

  const position = Number.isFinite(playhead)
    ? Math.max(0, Math.min(duration, playhead)) : 0;
  const occupied = segments
    .filter(segment => Number.isFinite(segment.start) &&
      Number.isFinite(segment.end) && segment.end > segment.start)
    .map(segment => ({
      start: Math.max(0, Math.min(duration, segment.start)),
      end: Math.max(0, Math.min(duration, segment.end)),
    }))
    .sort((a, b) => a.start - b.start);

  const gaps: { start: number; end: number }[] = [];
  let lastEnd = 0;
  for (const interval of occupied) {
    if (interval.start > lastEnd + TOLERANCE) {
      gaps.push({ start: lastEnd, end: interval.start });
    }
    lastEnd = Math.max(lastEnd, interval.end);
  }
  if (duration > lastEnd + TOLERANCE) {
    gaps.push({ start: lastEnd, end: duration });
  }

  // A gap that contains the playhead is preferred; otherwise choose the first
  // later gap. Never silently jump backwards through a long recording.
  for (const gap of gaps) {
    if (gap.end <= position + MIN_CUT_SECONDS - TOLERANCE) continue;
    const candidateStart = Math.max(gap.start, position);
    const start = Math.ceil((candidateStart - TOLERANCE) * HUNDREDTH) / HUNDREDTH;
    const end = Math.floor(
      (Math.min(gap.end, candidateStart + DEFAULT_CUT_SECONDS) + TOLERANCE)
      * HUNDREDTH,
    ) / HUNDREDTH;
    if (end - start >= MIN_CUT_SECONDS - TOLERANCE) return { start, end };
  }
  return null;
}
