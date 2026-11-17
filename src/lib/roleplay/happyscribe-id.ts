/**
 * HappyScribe transcription IDs appear as 40-digit hex strings in the
 * official API examples. Keep compatibility with older 32-digit and UUID
 * identifiers, but disallow path separators and arbitrary provider paths.
 */
const ID_PATTERN = /^(?:[a-f0-9]{32}|[a-f0-9]{40}|[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})$/i;

export function isValidHappyScribeId(value: string): boolean {
  return ID_PATTERN.test(value);
}
