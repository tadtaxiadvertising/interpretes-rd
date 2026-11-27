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

/** Spoken Spanish timestamp for native range controls; never changes the media position. */
export function formatStudioAccessibleTime(value: number, precision: 1 | 2 = 2): string {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
  const scale = 10 ** precision;
  const ticks = Math.round(safe * scale);
  const hours = Math.floor(ticks / (3600 * scale));
  const minutes = Math.floor(ticks / (60 * scale)) % 60;
  const seconds = (ticks % (60 * scale)) / scale;
  const parts: string[] = [];
  if (hours) parts.push(hours + (hours === 1 ? ' hora' : ' horas'));
  if (minutes) parts.push(minutes + (minutes === 1 ? ' minuto' : ' minutos'));
  parts.push(String(seconds).replace('.', ',') + (seconds === 1 ? ' segundo' : ' segundos'));
  return parts.join(', ');
}
