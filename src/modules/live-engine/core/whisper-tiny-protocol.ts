/**
 * Private, same-tab protocol for the experimental Whisper tiny WebAssembly
 * engine. Raw PCM is transferred between local Workers only: never persisted
 * or passed to a server API.
 */
export type WhisperLanguage = 'es' | 'en';

export type WhisperRequest =
  | { type: 'load'; language: WhisperLanguage }
  | {
      type: 'transcribe';
      id: number;
      language: WhisperLanguage;
      samples: Float32Array;
    };

export type WhisperResponse =
  | { type: 'progress'; percent: number }
  | { type: 'ready' }
  | { type: 'result'; id: number; text: string }
  | { type: 'error'; code: string; id?: number };

export interface WhisperWorkerPort {
  onmessage: ((event: MessageEvent<WhisperRequest>) => void) | null;
  postMessage(message: WhisperResponse): void;
}

export interface WhisperWorkerHandle {
  onmessage: ((event: MessageEvent<WhisperResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: WhisperRequest, transfer?: Transferable[]): void;
  terminate(): void;
}

export const WHISPER_TINY_MODEL = 'onnx-community/whisper-tiny';
export const WHISPER_MAX_SAMPLES = 30 * 16_000;
