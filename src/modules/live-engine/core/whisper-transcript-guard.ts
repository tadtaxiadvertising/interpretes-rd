/**
 * Fail-closed boundary for grossly abnormal Whisper generation.
 *
 * This is NOT a hallucination detector or WER validator: short incorrect
 * sentences must still be checked by the human interpreter. It only catches
 * runaway token loops (such as the Spanish eSpeak TTS regression) instead of
 * silently clipping their output and presenting them as valid text.
 */
export function validateWhisperTranscript(text: unknown, samples: number): string {
  if (typeof text !== 'string') throw new Error('LOCAL_WHISPER_INVALID_OUTPUT');
  if (!Number.isSafeInteger(samples) || samples < 1 || samples > 30 * 16_000) {
    throw new Error('LOCAL_WHISPER_INVALID_AUDIO');
  }
  const trimmed = text.trim();
  if (!trimmed) return '';

  const seconds = samples / 16_000;
  // These ceilings are intentionally far above ordinary human speech rates.
  // Only egregiously excessive generation should interrupt the session.
  const allowedWords = Math.max(30, Math.ceil(seconds * 10));
  const allowedChars = Math.max(450, Math.ceil(seconds * 110));
  const tokens = trimmed.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (tokens.length > allowedWords || trimmed.length > allowedChars) {
    throw new Error('LOCAL_WHISPER_SUSPICIOUS_OUTPUT');
  }
  return trimmed;
}
