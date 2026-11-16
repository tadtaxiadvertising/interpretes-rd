/**
 * Browser-native on-device text translation.
 *
 * The Translator API uses browser-managed language packs and local inference.
 * No network translation fallback is ever attempted by this adapter.
 * Download of the browser language pack may require an internet connection.
 */
export type LocalTranslationLanguage = 'es' | 'en';
export type LocalTranslationStatus = 'unsupported' | 'available' | 'downloadable' | 'downloading' | 'unavailable';
export type LocalTranslationDirection =
  | { sourceLanguage: 'es'; targetLanguage: 'en' }
  | { sourceLanguage: 'en'; targetLanguage: 'es' };

type DownloadEvent = { readonly loaded: number };
type DownloadMonitor = {
  addEventListener(name: 'downloadprogress', listener: (event: DownloadEvent) => void): void;
};
type TranslatorEngine = {
  translate(input: string, options?: { signal?: AbortSignal }): Promise<string>;
  destroy(): void;
};
type TranslatorFactory = {
  availability(direction: LocalTranslationDirection): Promise<Exclude<LocalTranslationStatus, 'unsupported'>>;
  create(options: LocalTranslationDirection & {
    signal?: AbortSignal;
    monitor?: (monitor: DownloadMonitor) => void;
  }): Promise<TranslatorEngine>;
};

function browserTranslator(): TranslatorFactory | null {
  if (typeof window === 'undefined' || !window.isSecureContext) return null;
  const candidate = (window as unknown as { Translator?: TranslatorFactory }).Translator;
  if (typeof candidate?.availability !== 'function' || typeof candidate.create !== 'function') return null;
  return candidate;
}

export function supportsLocalTranslation(): boolean {
  return browserTranslator() !== null;
}

export async function checkLocalTranslation(direction: LocalTranslationDirection): Promise<LocalTranslationStatus> {
  const factory = browserTranslator();
  if (!factory) return 'unsupported';
  return factory.availability(direction);
}

export interface LocalTranslatorSession {
  translate(input: string, signal?: AbortSignal): Promise<string>;
  close(): void;
}

/**
 * Called immediately inside a trusted user click: Translator.create() requires
 * transient user activation. Do not await availability before calling it.
 */
export async function createLocalTranslator(
  direction: LocalTranslationDirection,
  options: { signal?: AbortSignal; onDownloadProgress?: (fraction: number) => void } = {},
): Promise<LocalTranslatorSession> {
  const factory = browserTranslator();
  if (!factory) throw new Error('ON_DEVICE_TRANSLATION_UNSUPPORTED');

  const engine = await factory.create({
    ...direction,
    signal: options.signal,
    ...(options.onDownloadProgress
      ? { monitor(monitor: DownloadMonitor) {
          monitor.addEventListener('downloadprogress', ({ loaded }) => {
            if (Number.isFinite(loaded)) options.onDownloadProgress?.(Math.max(0, Math.min(1, loaded)));
          });
        } }
      : {}),
  });

  let closed = false;
  return {
    async translate(input: string, signal?: AbortSignal) {
      if (closed) throw new Error('LOCAL_TRANSLATOR_CLOSED');
      const text = input.trim();
      if (!text) throw new Error('EMPTY_TRANSLATION_INPUT');
      // Avoid exceeding model quotas and running huge inferences on basic PCs.
      if (text.length > 1800) throw new Error('TRANSLATION_INPUT_TOO_LONG');
      return engine.translate(text, signal ? { signal } : undefined);
    },
    close() {
      if (closed) return;
      closed = true;
      engine.destroy();
    },
  };
}
