/**
 * Browser-only waveform preview.
 *
 * The full audio is decoded only for short recordings; longer material uses
 * a timestamp ruler, so an hour-long MP3 never expands into hundreds of MiB
 * of PCM data on the administrator's laptop or phone.
 */
export const WAVEFORM_MAX_PREVIEW_SECONDS = 240;
export const WAVEFORM_MAX_PREVIEW_BYTES = 8 * 1024 * 1024;
export const WAVEFORM_BAR_COUNT = 240;

export function canRenderWaveform(duration: number, fileSize: number): boolean {
  return Number.isFinite(duration) && duration > 0 &&
    duration <= WAVEFORM_MAX_PREVIEW_SECONDS &&
    Number.isSafeInteger(fileSize) && fileSize > 0 &&
    fileSize <= WAVEFORM_MAX_PREVIEW_BYTES;
}

/**
 * Produce a fixed-size, normalized representation from browser-decoded PCM.
 * Sampling at most 96 frames per bin/channel bounds CPU independent of source
 * sample rate, while retaining visible differences between speaking/silence.
 */
export function calculateWaveformPeaks(
  channels: readonly Float32Array[],
  requestedBars: number = WAVEFORM_BAR_COUNT,
): number[] {
  if (!channels.length || !Number.isSafeInteger(requestedBars) || requestedBars < 1 ||
      requestedBars > 1024) return [];
  const frames = Math.min(...channels.map(channel => channel.length));
  if (!Number.isSafeInteger(frames) || frames < 1) return [];

  const bars = Math.min(frames, requestedBars);
  const peaks = new Array<number>(bars);
  for (let bin = 0; bin < bars; bin++) {
    const start = Math.floor(bin * frames / bars);
    const end = Math.max(start + 1, Math.floor((bin + 1) * frames / bars));
    const stride = Math.max(1, Math.floor((end - start) / 96));
    let peak = 0;
    for (let sample = start; sample < end; sample += stride) {
      for (const channel of channels) {
        const value = channel[sample];
        if (Number.isFinite(value)) peak = Math.max(peak, Math.abs(value));
      }
    }
    // Do not falsely amplify silence; small peaks still render as thin bars.
    peaks[bin] = Math.min(1, peak);
  }
  return peaks;
}
