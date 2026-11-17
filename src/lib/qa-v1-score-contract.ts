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

export function normalizeQaV1Points(input: QaV1PointScores, criticalError: boolean) {
  const normalized = {} as Record<keyof typeof QA_V1_POINT_LIMITS, number>;
  let totalPoints = 0;

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
    normalized[key] = Math.round((points / limit) * 10_000) / 100;
  }

  const persistedWeightedTotal = Object.entries(QA_V1_POINT_LIMITS).reduce(
    (total, [key, limit]) => total +
      normalized[key as keyof typeof QA_V1_POINT_LIMITS] * (limit / 100),
    0,
  );

  return {
    dimensions: normalized,
    totalScore: criticalError ? 0 : Math.round(persistedWeightedTotal * 100) / 100,
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
