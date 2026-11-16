export type LiveProcessingMode = 'local' | 'user-provider';

export type LiveLanguage = 'es' | 'en';

export interface DeviceCapabilities {
  mediaDevices: boolean;
  audioWorklet: boolean;
  webAssembly: boolean;
  webGPU: boolean;
  sharedArrayBuffer: boolean;
  estimatedDeviceMemoryGb: number | null;
  hardwareConcurrency: number;
}

export interface ProviderConsent {
  accepted: true;
  providerId: string;
  purpose: 'transcription' | 'translation';
  acceptedAt: string;
}

export interface SpeechProvider {
  readonly id: string;
  readonly label: string;
  readonly processingLocation: 'device' | 'provider';
  transcribe(input: {
    audio: Blob;
    language: LiveLanguage;
    signal: AbortSignal;
    consent?: ProviderConsent;
  }): Promise<{ text: string; language: LiveLanguage; isFinal: boolean }>;
}

export interface TranslationProvider {
  readonly id: string;
  readonly label: string;
  readonly processingLocation: 'device' | 'provider';
  translate(input: {
    text: string;
    sourceLanguage: LiveLanguage;
    targetLanguage: LiveLanguage;
    signal: AbortSignal;
    consent?: ProviderConsent;
  }): Promise<{ text: string }>;
}

export function detectDeviceCapabilities(): DeviceCapabilities {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      mediaDevices: false,
      audioWorklet: false,
      webAssembly: false,
      webGPU: false,
      sharedArrayBuffer: false,
      estimatedDeviceMemoryGb: null,
      hardwareConcurrency: 0,
    };
  }

  const nav = navigator as Navigator & {
    deviceMemory?: number;
    gpu?: unknown;
  };

  return {
    mediaDevices: !!navigator.mediaDevices?.getUserMedia,
    audioWorklet: typeof AudioWorkletNode !== 'undefined',
    webAssembly: typeof WebAssembly !== 'undefined',
    webGPU: !!nav.gpu,
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    estimatedDeviceMemoryGb: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    hardwareConcurrency: navigator.hardwareConcurrency || 1,
  };
}

/**
 * Provider calls must pass through this guard. A remote provider is never
 * invoked without a fresh, purpose-specific consent record.
 */
export function assertProviderConsent(
  provider: SpeechProvider | TranslationProvider,
  consent: ProviderConsent | undefined,
): void {
  if (provider.processingLocation === 'device') return;
  if (!consent || consent.accepted !== true || consent.providerId !== provider.id) {
    throw new Error('EXPLICIT_PROVIDER_CONSENT_REQUIRED');
  }
}
