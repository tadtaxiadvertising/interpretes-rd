/**
 * Production logs are the source of truth for payable/interpreted time.
 * Live/manual calls synchronize into productionLogs, so dashboards must not add
 * callSession duration on top of productionLogs or minutes will be double-counted.
 */
export function getEffectiveLogMinutes(log: {
  interpretedMinutes?: number | null;
  verifiedMinutes?: number | null;
}) {
  return Number(log.verifiedMinutes ?? log.interpretedMinutes ?? 0);
}

export function sumEffectiveLogMinutes(
  logs: Array<{ interpretedMinutes?: number | null; verifiedMinutes?: number | null }> | null | undefined
) {
  return (logs || []).reduce((sum, log) => sum + getEffectiveLogMinutes(log), 0);
}

export function getMonthBoundsForPeriod(period: string): { startOfMonth: Date; endOfMonth: Date } {
  const match = /^(\d{4})-(\d{2})$/.exec(period.trim());
  if (!match) {
    throw new Error(`Invalid period: ${period}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`Invalid period: ${period}`);
  }
  return {
    startOfMonth: new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0)),
    endOfMonth: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)),
  };
}

export function getMonthBounds(now = new Date()) {
  // Determine the current month in America/Santo_Domingo timezone,
  // matching how ProductionLog.date values are stored.
  const sd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santo_Domingo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const [year, month] = sd.split('-').map(Number);

  // Use UTC midnight bounds — PostgreSQL DATE comparison converts DATE
  // to midnight in the session timezone, which is always ≤ any time on
  // that day, so UTC midnight includes the entire calendar day.
  const startOfMonth = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const endOfMonth = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

  return { startOfMonth, endOfMonth };
}

export function getDayBounds(now = new Date()) {
  // Determine "today" in America/Santo_Domingo timezone, not UTC,
  // so that logs created in late Santo Domingo hours map to the correct day.
  const sd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santo_Domingo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const [year, month, day] = sd.split('-').map(Number);

  const startOfDay = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  const endOfDay = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));

  return { startOfDay, endOfDay };
}
