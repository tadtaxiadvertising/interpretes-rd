/**
 * Browser-native on-device speech recognition.
 *
 * Safety invariant: never start if the browser cannot explicitly guarantee
 * processLocally=true. Web Speech's default may use a remote service.
 */
export type LocalSpeechLanguage = 'es-ES' | 'en-US';
export type LocalSpeechPackStatus = 'unsupported' | 'available' | 'downloadable' | 'downloading' | 'unavailable';

type RecognitionResult = {
  readonly isFinal: boolean;
  readonly 0: { readonly transcript: string };
};
type RecognitionResultEvent = {
  readonly resultIndex: number;
  readonly results: ArrayLike<RecognitionResult>;
};
type BrowserRecognizer = {
  lang: string;
  processLocally: boolean;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
};
type BrowserRecognizerConstructor = {
  new (): BrowserRecognizer;
  available(options: { langs: string[]; processLocally: true; quality: 'dictation' }): Promise<'available' | 'downloadable' | 'downloading' | 'unavailable'>;
  install(options: { langs: string[]; processLocally: true; quality: 'dictation' }): Promise<boolean>;
};

function getRecognizer(): BrowserRecognizerConstructor | null {
  if (typeof window === 'undefined') return null;
  const candidate = (window as unknown as { SpeechRecognition?: BrowserRecognizerConstructor }).SpeechRecognition;
  if (!candidate || typeof candidate.available !== 'function' || typeof candidate.install !== 'function') {
    return null;
  }
  return candidate;
}

export function supportsOnDeviceSpeech(): boolean {
  return getRecognizer() !== null;
}

export async function checkOnDeviceSpeechPack(language: LocalSpeechLanguage): Promise<LocalSpeechPackStatus> {
  const recognition = getRecognizer();
  if (!recognition) return 'unsupported';
  // Never use processLocally=false, even as a fallback.
  return recognition.available({ langs: [language], processLocally: true, quality: 'dictation' });
}

/** Must only be called after a separate, explicit user interaction. */
export async function installOnDeviceSpeechPack(language: LocalSpeechLanguage): Promise<boolean> {
  const recognition = getRecognizer();
  if (!recognition) throw new Error('ON_DEVICE_SPEECH_UNSUPPORTED');
  return recognition.install({ langs: [language], processLocally: true, quality: 'dictation' });
}

export interface LocalSpeechSession {
  stop(): void;
}

/**
 * Must be invoked from a user gesture after a confirmed 'available' status.
 * This never falls back to cloud recognition.
 */
export function startOnDeviceSpeech(
  language: LocalSpeechLanguage,
  onResult: (text: string, isFinal: boolean) => void,
  onError: (message: string) => void,
  onEnd: () => void,
): LocalSpeechSession {
  const Constructor = getRecognizer();
  if (!Constructor) throw new Error('ON_DEVICE_SPEECH_UNSUPPORTED');
  const recognizer = new Constructor();
  if (!('processLocally' in recognizer)) throw new Error('ON_DEVICE_SPEECH_UNSUPPORTED');
  recognizer.processLocally = true;
  if (recognizer.processLocally !== true) throw new Error('ON_DEVICE_SPEECH_UNSUPPORTED');
  recognizer.lang = language;
  recognizer.continuous = true;
  recognizer.interimResults = true;
  let stopped = false;
  recognizer.onresult = (event) => {
    if (stopped) return;
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const text = result?.[0]?.transcript?.trim();
      if (text) onResult(text, result.isFinal);
    }
  };
  recognizer.onerror = (event) => { if (!stopped) onError(event.error); };
  recognizer.onend = () => { if (!stopped) onEnd(); };
  recognizer.start();
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      recognizer.onresult = null;
      recognizer.onerror = null;
      recognizer.onend = null;
      recognizer.abort();
    },
  };
}
