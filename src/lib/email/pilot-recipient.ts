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
