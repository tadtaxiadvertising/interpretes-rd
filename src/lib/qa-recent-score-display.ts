/**
 * UI-only classification for QA history. A missing score is not zero and a
 * score of zero is not proof of a critical error. Never infer criticalError
 * from totalScore.
 */
export type QaDisplaySeverity = 'critical' | 'unscored' | 'excellent' | 'low' | 'review';

export function qaRecentScoreDisplay(
  storedTotal: { toString(): string } | number | null | undefined,
  criticalError: boolean | null | undefined,
): { severity: QaDisplaySeverity; scoreLabel: string; criticalLabel: string | null } {
  const total = storedTotal == null ? null : Number(storedTotal);
  const valid = total !== null && Number.isFinite(total) && total >= 0 && total <= 100;
  const severity: QaDisplaySeverity = criticalError === true ? 'critical'
    : !valid ? 'unscored'
      : total >= 85 ? 'excellent'
        : total < 70 ? 'low' : 'review';

  return {
    severity,
    scoreLabel: valid ? total.toFixed(2) + '%' : 'Sin puntuación',
    criticalLabel: criticalError === true ? 'Error crítico' : null,
  };
}
