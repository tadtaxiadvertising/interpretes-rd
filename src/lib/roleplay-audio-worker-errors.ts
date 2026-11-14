/**
 * Only allow stable, non-sensitive error categories into job history, response
 * processingError and central logs. Storage/Prisma/FFmpeg exceptions can carry
 * URLs, tokens, local filenames, metadata and occasionally private text.
 *
 * Caller-controlled Error.message and Error.name are never copied verbatim.
 */
export function safeRoleplayAudioJobError(error: unknown): string {
  if (!(error instanceof Error)) return 'Roleplay audio processing failed';

  const message = error.message;

  const safeExactMessages = new Set([
    'Source audio is empty or exceeds the 15 MB processing limit',
    'FFmpeg conversion exceeded the 180-second time limit',
    'FFmpeg binary is not available in this runtime',
    'MP3 conversion requires a WebM source path',
    'Invalid audio conversion attempt identifier',
    'Roleplay audio object was not uploaded or is inaccessible',
  ]);
  if (safeExactMessages.has(message)) return message;

  // Keep actionable length information only if the entire error matches an
  // unambiguous numeric template; do not interpolate arbitrary substrings.
  const overLimit = /^Recording is (\d{1,6}) seconds long; the maximum is (\d{1,6}) seconds$/.exec(message);
  if (overLimit) {
    return `Recording exceeds duration limit (${overLimit[1]}s / ${overLimit[2]}s)`;
  }

  if (message.startsWith('Failed to download source audio:')) return 'Failed to download source audio';
  if (message.startsWith('Failed to upload MP3:')) return 'Failed to upload processed audio';
  if (message.startsWith('FFmpeg exited with code ') ||
      message.startsWith('FFmpeg process error:')) return 'FFmpeg conversion failed';

  return 'Roleplay audio processing failed';
}
