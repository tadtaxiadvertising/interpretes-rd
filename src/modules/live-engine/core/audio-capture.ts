export interface AudioCaptureOptions {
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
}

/**
 * Acquires a microphone stream in the current browser tab.
 * This module does not record, upload, persist, or transmit audio.
 */
export async function acquireMicrophone(
  options: AudioCaptureOptions = {},
): Promise<MediaStream> {
  if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('MICROPHONE_API_UNAVAILABLE');
  }

  return navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: options.echoCancellation ?? true,
      noiseSuppression: options.noiseSuppression ?? true,
      autoGainControl: options.autoGainControl ?? true,
    },
    video: false,
  });
}

export function releaseMicrophone(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}
