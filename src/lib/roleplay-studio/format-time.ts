/**
 * Audio Studio timeline labels only: preserve source intervals unmodified.
 *
 * Round the total first so a time near a minute/hour boundary never renders
 * impossible labels such as 00:60.0 or 00:59:60.0.
 */
export function formatStudioTime(value: number): string {
  const safeSeconds = Number.isFinite(value) ? Math.max(0, value) : 0;
  const tenths = Math.round(safeSeconds * 10);
  const hours = Math.floor(tenths / 36_000);
  const minutes = Math.floor(tenths / 600) % 60;
  const secondsTenths = tenths % 600;
  const seconds = String(Math.floor(secondsTenths / 10)).padStart(2, '0') +
    '.' + String(secondsTenths % 10);
  return hours
    ? String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0') + ':' + seconds
    : String(Math.floor(tenths / 600)).padStart(2, '0') + ':' + seconds;
}
