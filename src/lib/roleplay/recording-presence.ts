/**
 * Determine whether a confirmed RoleplayResponse has a persisted recording
 * reference. Newer rows retain canonical Storage paths even after the older
 * seven-day signed URL is absent or expired.
 *
 * Call only with response rows read from the database, never with user input.
 * This is a workflow-presence check, not an authorization or Storage probe.
 */
export function hasPersistedRoleplayRecording(response: {
  sourceAudioUrl?: string | null;
  sourceAudioPath?: string | null;
  processedAudioPath?: string | null;
} | null | undefined): boolean {
  if (!response) return false;
  return [
    response.sourceAudioPath,
    response.processedAudioPath,
    response.sourceAudioUrl,
  ].some(value => typeof value === 'string' && value.trim().length > 0);
}
