/**
 * Audio MIME types accepted by the legacy admin multipart importer.
 *
 * An uploaded File.name is untrusted and must not determine the stored object
 * suffix. Use one canonical, bounded extension for each supported MIME.
 * Content verification remains a separate concern: MIME is user-supplied.
 */
const ADMIN_AUDIO_EXTENSIONS = {
  'audio/webm': 'webm',
  'audio/mp4': 'mp4',
  'audio/wav': 'wav',
  'audio/mpeg': 'mp3',
} as const;

export function getAdminRoleplayAudioExtension(
  mime: string,
): 'webm' | 'mp4' | 'wav' | 'mp3' | null {
  if (!Object.prototype.hasOwnProperty.call(ADMIN_AUDIO_EXTENSIONS, mime)) {
    return null;
  }
  return ADMIN_AUDIO_EXTENSIONS[mime as keyof typeof ADMIN_AUDIO_EXTENSIONS];
}
