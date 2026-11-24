/** An optional server-side allowlist for a controlled recruitment pilot.
 * Empty means ordinary discovery; an invalid nonempty value fails closed.
 */
export function pilotRecipient(env: Readonly<Record<string, string | undefined>>): string | null | false {
  const raw = env.OPERATIONAL_EMAIL_PILOT_RECIPIENT;
  if (raw === undefined || raw === '') return null;
  const normalized = raw.trim().toLowerCase();
  if (normalized.length > 254 || !/^[a-zA-Z0-9.!#$%&'*+/=?^_~|-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/.test(normalized)) return false;
  return normalized;
}

/** General delivery requires an explicit second opt-in; mixed modes fail closed. */
export function emailDeliveryMode(env: Readonly<Record<string, string | undefined>>): 'pilot' | 'general' | 'disabled' {
  const recipient = pilotRecipient(env);
  const general = env.OPERATIONAL_EMAIL_GENERAL_ENABLED === 'true';
  if (recipient === false || (recipient && general)) return 'disabled';
  return recipient ? 'pilot' : general ? 'general' : 'disabled';
}
