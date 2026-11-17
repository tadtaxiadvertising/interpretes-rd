/**
 * Non-destructive, browser-only audition of two disjoint source intervals.
 *
 * The published Roleplay Studio v1 format accepts exactly one continuous
 * interval per intervention. This planner MUST NOT be reused to export a
 * combined audio file without first extending every validated exporter.
 */
export type GaplessSourceTurn = {
  start: number;
  end: number;
  speakerRole: string;
  language: string;
};

export type GaplessPairPlan = {
  first: { start: number; end: number };
  second: { start: number; end: number };
  skippedSeconds: number;
  selectedSeconds: number;
};

export function planGaplessPair(
  first: GaplessSourceTurn | undefined,
  second: GaplessSourceTurn | undefined,
  sourceDuration: number,
): GaplessPairPlan | null {
  if (!first || !second || !Number.isFinite(sourceDuration) || sourceDuration <= 0) return null;
  const values = [first.start, first.end, second.start, second.end];
  if (values.some(value => !Number.isFinite(value)) ||
      first.start < 0 || first.end > sourceDuration + 0.1 ||
      second.end > sourceDuration + 0.1 ||
      first.end - first.start < 0.1 || second.end - second.start < 0.1 ||
      first.speakerRole !== second.speakerRole ||
      first.language !== second.language ||
      first.speakerRole === 'interpreter') return null;

  const skippedSeconds = second.start - first.end;
  const selectedSeconds = first.end - first.start + second.end - second.start;
  // Existing contiguous "Unir" handles <= 2 s. The audition is specifically
  // for longer gaps and is limited to a potential 5-minute exported scene.
  if (skippedSeconds <= 2 || selectedSeconds > 300) return null;

  return {
    first: { start: first.start, end: first.end },
    second: { start: second.start, end: second.end },
    skippedSeconds,
    selectedSeconds,
  };
}
