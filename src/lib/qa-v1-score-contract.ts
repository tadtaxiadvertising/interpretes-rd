/**
 * Legacy /api/v1/qa accepts point contributions capped at 20/40/20/10/10.
 * Persisting these as percentages is essential: the canonical QA actions
 * and any weighted-total database trigger interpret each stored dimension
 * on a 0–100 scale. Never apply the weights twice to the legacy points.
 */
export const QA_V1_POINT_LIMITS = {
  protocolScore: 20,
  interpretationScore: 40,
  languageScore: 20,
  serviceScore: 10,
  technicalScore: 10,
} as const;

export type QaV1PointScores = {
  [Key in keyof typeof QA_V1_POINT_LIMITS]?: number | null;
};

/**
 * Use base-10 integer arithmetic for two-decimal PostgreSQL NUMERIC values.
 * Binary floats can turn exact ties such as 12.35 / 40 * 100 = 30.875 into
 * 30.874999..., incorrectly rounding 30.88 down to 30.87.
 */
function normalizedPercentageCents(points: number, limit: number): bigint {
  const match = /^(\\d+)(?:\\.(\\d+))?(?:e([+-]?\\d+))?$/i.exec(String(points));
  if (!match) throw new Error('Invalid QA dimension');
  const fraction = match[2] ?? '';
  const exponent = Number(match[3] ?? 0);
  const places = fraction.length - exponent;
  let numerator = BigInt(match[1] + fraction) * 10_000n;
  let denominator = BigInt(limit);
  if (places >= 0) {
    denominator *= 10n ** BigInt(places);
  } else {
    numerator *= 10n ** BigInt(-places);
  }
  // Exact positive half-up rounding to 0.01 percentage points.
  return (numerator * 2n + denominator) / (2n * denominator);
}

export function normalizeQaV1Points(input: QaV1PointScores, criticalError: boolean) {
  const normalized = {} as Record<keyof typeof QA_V1_POINT_LIMITS, number>;
  let totalPoints = 0;
  let weightedPercentageBasis = 0n;

  for (const [key, limit] of Object.entries(QA_V1_POINT_LIMITS) as Array<
    [keyof typeof QA_V1_POINT_LIMITS, number]
  >) {
    const points = input[key] ?? 0;
    // Input should already be validated by QAScoreSchema. Fail closed if
    // this function is ever used without that boundary.
    if (!Number.isFinite(points) || points < 0 || points > limit) {
      throw new Error('Invalid QA dimension');
    }
    totalPoints += points;
    // Postgres qa_scores dimensions are NUMERIC(5,2), with 0..100 ranges.
    // Round the normalized percentages before calculating the expected sum
    // to match the values that a DB trigger reads after persistence.
    const percentageCents = normalizedPercentageCents(points, limit);
    normalized[key] = Number(percentageCents) / 100;
    weightedPercentageBasis += percentageCents * BigInt(limit);
  }

  // Each persisted dimension has exactly two decimal places. Apply the
  // percentage weights after that rounding with integer arithmetic.
  const expectedCents = (weightedPercentageBasis + 50n) / 100n;
  return {
    dimensions: normalized,
    totalScore: criticalError ? 0 : Number(expectedCents) / 100,
    rawPointTotal: Math.round(totalPoints * 100) / 100,
  };
}

/**
 * Verify a score AFTER INSERT and before COMMIT, because a database trigger
 * might replace application-calculated total_score. Reject and roll back
 * rather than silently issuing a falsely low (or falsely high) QA result.
 */
export function qaV1StoredTotalMatches(stored: unknown, expected: number): boolean {
  if (stored === null || stored === undefined) return false;
  if (typeof stored !== 'number' && typeof stored !== 'string' &&
      !(typeof stored === 'object' && stored !== null && 'toString' in stored)) return false;
  const actual = Number(stored);
  return Number.isFinite(actual) && Number.isFinite(expected) &&
    Math.abs(actual - expected) <= 0.011;
}
