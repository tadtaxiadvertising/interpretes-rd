/**
 * Canonical QA score (per-dimension percentages, weighted 20/40/20/10/10).
 *
 * Convert the already-validated two-decimal percentages to integer cents
 * before applying weights. This avoids JS binary float half-tie mistakes:
 * 6.49/31.72/90.83/46.41/34.62 -> 40.26, not 40.25.
 */
export const QA_CANONICAL_WEIGHTS = {
  protocolScore: 20,
  interpretationScore: 40,
  languageScore: 20,
  serviceScore: 10,
  technicalScore: 10,
} as const;

export type QaCanonicalScores = Record<keyof typeof QA_CANONICAL_WEIGHTS, number>;

export function calculateCanonicalQaTotal(scores: QaCanonicalScores, criticalError: boolean): number {
  let weightedBasis = 0;
  for (const [key, weight] of Object.entries(QA_CANONICAL_WEIGHTS) as
    Array<[keyof typeof QA_CANONICAL_WEIGHTS, number]>) {
    const value = scores[key];
    const cents = Math.round(value * 100);
    if (!Number.isFinite(value) || value < 0 || value > 100 ||
        Math.abs(value * 100 - cents) >= 1e-7) {
      throw new Error('Invalid canonical QA percentage');
    }
    weightedBasis += cents * weight;
  }
  // Denominator 100 converts weighted score basis into hundredths.
  // Add 50 for positive half-up rounding with exact integer arithmetic.
  const totalCents = Math.floor((weightedBasis + 50) / 100);
  return criticalError ? 0 : totalCents / 100;
}
