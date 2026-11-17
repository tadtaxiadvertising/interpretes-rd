/**
 * Notification recipient IDs are UUIDs. An authenticated account can have
 * both an auth identity ID and a separate linked UserProfile ID (Auth.js).
 * These values are supplied by trusted server-side identity resolution only,
 * never by client notification payloads.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function authorizedNotificationRecipientIds(
  authenticatedUserId: string | null | undefined,
  linkedProfileId: string | null | undefined,
): string[] {
  const result: string[] = [];
  for (const candidate of [authenticatedUserId, linkedProfileId]) {
    if (typeof candidate !== 'string' || !UUID_RE.test(candidate)) continue;
    if (!result.some(id => id.toLowerCase() === candidate.toLowerCase())) {
      result.push(candidate);
    }
  }
  return result;
}
