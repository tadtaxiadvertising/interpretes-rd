/**
 * Time-accounting only: these gaps are NOT acoustic silence detections.
 * The export tool extracts selected clips and does not preserve unselected
 * stretches between them. This helper never reads or decodes source media.
 */
export interface StudioInterval { start: number; end: number }
export interface StudioGap { start: number; end: number; duration: number }
export interface StudioCoverage {
  selectedSeconds: number;
  excludedSeconds: number;
  gaps: StudioGap[];
  hasOverlaps: boolean;
}

export function summarizeStudioCoverage(
  sourceDuration: number,
  intervals: readonly StudioInterval[],
): StudioCoverage {
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) {
    return { selectedSeconds: 0, excludedSeconds: 0, gaps: [], hasOverlaps: false };
  }
  const valid = intervals
    .filter(interval => Number.isFinite(interval.start) &&
      Number.isFinite(interval.end) && interval.end > interval.start)
    .map(({ start, end }) => ({
      start: Math.max(0, Math.min(sourceDuration, start)),
      end: Math.max(0, Math.min(sourceDuration, end)),
    }))
    .filter(interval => interval.end > interval.start)
    .sort((a, b) => a.start - b.start);

  const merged: StudioInterval[] = [];
  let hasOverlaps = false;
  for (const interval of valid) {
    const previous = merged[merged.length - 1];
    if (!previous || interval.start >= previous.end) {
      merged.push({ ...interval });
    } else {
      hasOverlaps = true;
      previous.end = Math.max(previous.end, interval.end);
    }
  }

  let cursor = 0;
  let selectedSeconds = 0;
  const gaps: StudioGap[] = [];
  for (const interval of merged) {
    if (interval.start > cursor) {
      gaps.push({
        start: cursor,
        end: interval.start,
        duration: interval.start - cursor,
      });
    }
    selectedSeconds += interval.end - interval.start;
    cursor = interval.end;
  }
  if (cursor < sourceDuration) {
    gaps.push({
      start: cursor,
      end: sourceDuration,
      duration: sourceDuration - cursor,
    });
  }

  return {
    selectedSeconds,
    excludedSeconds: Math.max(0, sourceDuration - selectedSeconds),
    gaps,
    hasOverlaps,
  };
}
