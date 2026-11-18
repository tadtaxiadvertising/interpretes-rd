/**
 * Payroll payment-day rules are configured for the operational timezone,
 * not the runtime's TZ (which may be UTC in Easypanel/CI).
 *
 * Return the same English weekday and non-padded day-of-month values used by
 * Interpreter.paymentDay for Weekly, Biweekly, and Monthly schedules.
 */
export function getSantoDomingoPaymentDay(date: Date | string): {
  dayOfWeek: string;
  dayOfMonth: string;
} {
  // YYYY-MM-DD is an explicit calendar day, not a timestamp in UTC.
  // Noon UTC is safely within the requested Santo Domingo calendar day.
  let instant: Date;
  if (typeof date === 'string') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error('Invalid payment calendar date');
    }
    instant = new Date(`${date}T12:00:00.000Z`);
    if (!Number.isFinite(instant.getTime()) || instant.toISOString().slice(0, 10) !== date) {
      throw new Error('Invalid payment calendar date');
    }
  } else {
    instant = date;
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Santo_Domingo',
    weekday: 'long',
    day: 'numeric',
  }).formatToParts(instant);

  const dayOfWeek = parts.find((part) => part.type === 'weekday')?.value;
  const dayOfMonth = parts.find((part) => part.type === 'day')?.value;

  if (!dayOfWeek || !dayOfMonth) {
    throw new Error('Cannot determine payment day in operational timezone');
  }
  return { dayOfWeek, dayOfMonth };
}
