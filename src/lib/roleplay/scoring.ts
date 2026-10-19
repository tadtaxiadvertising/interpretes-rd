/**
 * Canonical roleplay scoring.
 *
 * Single source of truth for converting the five QA dimension scores into a
 * 0..100 total. Every consumer (server actions, admin UI preview, tests) must
 * use this function — never inline weights again.
 *
 * Input dimensions are 0..10. Weights: protocol 35%, interpretation 40%,
 * language 15%, service 5%, technical 5%. A critical error forces the total
 * to exactly 0 regardless of dimension scores.
 */

export const ROLEPLAY_DIMENSIONS = [
  'protocol',
  'interpretation',
  'language',
  'service',
  'technical',
] as const;

export type RoleplayDimension = (typeof ROLEPLAY_DIMENSIONS)[number];

export const ROLEPLAY_WEIGHTS: Record<RoleplayDimension, number> = {
  protocol: 0.35,
  interpretation: 0.4,
  language: 0.15,
  service: 0.05,
  technical: 0.05,
};

export const ROLEPLAY_DIMENSION_MIN = 0;
export const ROLEPLAY_DIMENSION_MAX = 10;

/** Minimum total (0..100) considered a pass. */
export const ROLEPLAY_PASS_THRESHOLD = 70;

/** Minimum total (0..100) that avoids the "Feedback Requerido" action. */
export const ROLEPLAY_REVIEW_THRESHOLD = 85;

export type RoleplayScoreInput = Record<RoleplayDimension, number> & {
  criticalError?: boolean;
};

export type RoleplayActionRequired = 'Ninguna' | 'Feedback Requerido' | 'Advertencia / Coaching';

export type RoleplayScoreResult = {
  /** Weighted total scaled to 0..100, rounded to 2 decimals. 0 when criticalError. */
  totalScore: number;
  passed: boolean;
  actionRequired: RoleplayActionRequired;
};

export function isDimensionScore(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= ROLEPLAY_DIMENSION_MIN &&
    value <= ROLEPLAY_DIMENSION_MAX
  );
}

/**
 * Clamps a raw numeric value into the valid 0..10 dimension range.
 * Useful for client previews where typed input may exceed the range.
 */
export function clampDimensionScore(value: number): number {
  if (!Number.isFinite(value)) return ROLEPLAY_DIMENSION_MIN;
  return Math.min(ROLEPLAY_DIMENSION_MAX, Math.max(ROLEPLAY_DIMENSION_MIN, value));
}

/**
 * Computes the canonical roleplay score.
 *
 * @throws RangeError when any dimension is outside 0..10 or is not finite.
 *   Callers must validate input before computing (Zod at action boundaries).
 */
export function calculateRoleplayScore(input: RoleplayScoreInput): RoleplayScoreResult {
  for (const dimension of ROLEPLAY_DIMENSIONS) {
    if (!isDimensionScore(input[dimension])) {
      throw new RangeError(
        `Roleplay score "${dimension}" must be a number between ${ROLEPLAY_DIMENSION_MIN} and ${ROLEPLAY_DIMENSION_MAX}`
      );
    }
  }

  const criticalError = input.criticalError === true;
  let totalScore = 0;

  if (!criticalError) {
    const weighted =
      input.protocol * ROLEPLAY_WEIGHTS.protocol +
      input.interpretation * ROLEPLAY_WEIGHTS.interpretation +
      input.language * ROLEPLAY_WEIGHTS.language +
      input.service * ROLEPLAY_WEIGHTS.service +
      input.technical * ROLEPLAY_WEIGHTS.technical;
    // Dimension inputs are 0..10; scale the weighted sum to the 0..100 range.
    totalScore = Math.round(weighted * 10 * 100) / 100;
  }

  let actionRequired: RoleplayActionRequired = 'Ninguna';
  if (criticalError || totalScore < ROLEPLAY_PASS_THRESHOLD) {
    actionRequired = 'Advertencia / Coaching';
  } else if (totalScore < ROLEPLAY_REVIEW_THRESHOLD) {
    actionRequired = 'Feedback Requerido';
  }

  return {
    totalScore,
    passed: !criticalError && totalScore >= ROLEPLAY_PASS_THRESHOLD,
    actionRequired,
  };
}
