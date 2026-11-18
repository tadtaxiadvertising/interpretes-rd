/**
 * Payroll payment-day rules are configured for the operational timezone,
 * not the runtime's TZ (which may be UTC in Easypanel/CI).
 *
 * Return the same English weekday and non-padded day-of-month values used by
 * Interpreter.paymentDay for Weekly, Biweekly, and Monthly schedules.
 */
export function getSantoDomingoPaymentDay(date: Date): {
  dayOfWeek: string;
  dayOfMonth: string;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Santo_Domingo',
    weekday: 'long',
    day: 'numeric',
  }).formatToParts(date);

  const dayOfWeek = parts.find((part) => part.type === 'weekday')?.value;
  const dayOfMonth = parts.find((part) => part.type === 'day')?.value;

  if (!dayOfWeek || !dayOfMonth) {
    throw new Error('Cannot determine payment day in operational timezone');
  }
  return { dayOfWeek, dayOfMonth };
}
