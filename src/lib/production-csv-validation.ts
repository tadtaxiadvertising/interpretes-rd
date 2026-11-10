export const MAX_PRODUCTION_CHUNK_ROWS = 500;
export const MAX_PRODUCTION_CHUNK_BYTES = 2 * 1024 * 1024;

export function parseProductionMinutes(value: string | undefined): number | null {
  const normalized = value?.trim() ?? '';
  if (!normalized) return 0;
  if (!/^(?:0|[1-9]\d{0,5})$/.test(normalized)) return null;
  const minutes = Number(normalized);
  return Number.isSafeInteger(minutes) && minutes <= 100_000 ? minutes : null;
}

export function parseProductionAdherence(value: string | undefined): number | null {
  const normalized = value?.trim() ?? '';
  if (!normalized) return 0;
  if (!/^(?:100(?:\.0{1,2})?|(?:\d|[1-9]\d)(?:\.\d{1,2})?)$/.test(normalized)) return null;
  const adherence = Number(normalized);
  return Number.isFinite(adherence) && adherence >= 0 && adherence <= 100
    ? Math.round(adherence * 100) / 100
    : null;
}
