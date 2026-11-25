/**
 * Escape text from legacy administrative exports without changing their
 * headers, line endings, or ordinary numeric representations.
 */
export function csvTextCell(value: unknown, forceQuote = false): string {
  const normalized = String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ');
  // Check after leading whitespace, including the full-width formula markers.
  const formulaLike = /^[=+@\-＝＋＠－]/.test(normalized.trimStart());
  const safe = formulaLike ? "'" + normalized.trimStart() : normalized;
  return forceQuote || formulaLike || /[",]/.test(safe)
    ? '"' + safe.replace(/"/g, '""') + '"'
    : safe;
}

/** Only use for known numeric columns. Never interpret arbitrary text as a formula. */
export function csvNumberCell(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value) &&
      Number.isFinite(Number(value))) return value;
  return csvTextCell(value);
}
