/**
 * Audio Studio project v2: one published scenario can be assembled from two
 * source intervals without reproducing the gap between them.
 *
 * v1 projects contain only start/end. v2 projects explicitly declare ranges.
 * Never infer compound audio from the outer start/end bounding box.
 */
export interface StudioCutRange { start: number; end: number }

export function validStudioRanges(
  segment: { start: number; end: number; ranges?: unknown },
  sourceDuration: number,
): StudioCutRange[] | null {
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0 ||
      !Number.isFinite(segment.start) || !Number.isFinite(segment.end)) return null;

  const validate = (range: StudioCutRange): boolean =>
    Number.isFinite(range.start) && Number.isFinite(range.end) &&
    range.start >= 0 && range.end <= sourceDuration + 0.1 &&
    range.end - range.start >= 0.1 - 1e-6;

  if (segment.ranges === undefined) {
    const single = { start: segment.start, end: segment.end };
    return validate(single) && single.end - single.start <= 300 ? [single] : null;
  }

  // v2 currently supports exactly two cuts. A newer version is needed for
  // more pieces so legacy tools cannot silently flatten a compound scene.
  if (!Array.isArray(segment.ranges) || segment.ranges.length !== 2) return null;
  const [first, second] = segment.ranges;
  if (!first || !second || typeof first !== 'object' || typeof second !== 'object' ||
      Array.isArray(first) || Array.isArray(second)) return null;
  const a = first as StudioCutRange;
  const b = second as StudioCutRange;
  if (!validate(a) || !validate(b) ||
      Math.abs(segment.start - a.start) > 1e-6 ||
      Math.abs(segment.end - b.end) > 1e-6 ||
      b.start - a.end <= 2 + 1e-6 ||
      a.end - a.start + b.end - b.start > 300 + 1e-6) return null;
  return [{ start: a.start, end: a.end }, { start: b.start, end: b.end }];
}

export function studioSelectedSeconds(ranges: readonly StudioCutRange[]): number {
  return ranges.reduce((sum, range) => sum + range.end - range.start, 0);
}
