/**
 * Produce a spreadsheet-safe CSV for administrative QA exports.
 * CSV quoting alone does not prevent spreadsheet formula execution.
 */
export type QAExportRow = {
  id: number;
  auditDate: string | Date;
  auditor: string | null;
  totalScore: number | string;
  criticalError: boolean;
  comentarios: string | null;
  interpreter: { name: string } | null;
};

export const QA_CSV_HEADERS = [
  'Date', 'Interpreter', 'Auditor', 'Total Score', 'Critical Error', 'Status', 'Comments',
] as const;

/** Escape both CSV delimiters and formula-like cells, including after whitespace. */
export function qaSafeCsvCell(value: unknown): string {
  const normalized = String(value ?? '')
    // Keep one physical CSV row per QA record and prevent hidden line breaks
    // from supplying new formula-bearing cells.
    .replace(/[\u0000-\u001f\u007f]+/g, ' ');

  const stripped = normalized.trimStart();
  const safe = /^[=+@-]/.test(stripped)
    ? "'" + stripped
    : normalized;
  return '"' + safe.replace(/"/g, '""') + '"';
}

function safeIsoDate(value: string | Date): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : '';
}

export function buildQaScoresCsv(rows: readonly QAExportRow[]): string {
  const lines = [
    QA_CSV_HEADERS.map(qaSafeCsvCell).join(','),
    ...rows.map(score => [
      safeIsoDate(score.auditDate),
      score.interpreter?.name ?? 'Desconocido',
      score.auditor ?? 'System',
      String(score.totalScore) + '%',
      score.criticalError ? 'YES' : 'NO',
      score.criticalError ? 'FAILED' : 'PASSED',
      score.comentarios ?? '',
    ].map(qaSafeCsvCell).join(',')),
  ];
  // UTF-8 BOM improves compatibility with Excel and accented Spanish names.
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}
