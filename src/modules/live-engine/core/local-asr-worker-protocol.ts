import type { LocalPcmChunk } from './local-pcm-chunks';

/**
 * Single-session, pull-based protocol.
 * At most one source frame AND one completed ASR window can be in flight.
 * All payloads stay inside the user's browser. No network operations.
 */
export type HostToLocalAsrWorker =
  | {
      type: 'init';
      sourceSampleRate: number;
      chunkDurationMs?: number;
      overlapDurationMs?: number;
    }
  | { type: 'next' }
  | { type: 'frame'; samples: Float32Array }
  | { type: 'input-end' }
  | { type: 'input-error'; code: string };

export type LocalAsrWorkerToHost =
  | { type: 'ready' }
  | { type: 'need-frame' }
  | { type: 'chunk'; chunk: LocalPcmChunk }
  | { type: 'done' }
  | { type: 'error'; code: string };

export interface LocalAsrWorkerEndpoint {
  onmessage: ((event: MessageEvent<HostToLocalAsrWorker>) => void) | null;
  postMessage(message: LocalAsrWorkerToHost, transfer?: Transferable[]): void;
}

export interface LocalAsrWorkerHandle {
  onmessage: ((event: MessageEvent<LocalAsrWorkerToHost>) => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: HostToLocalAsrWorker, transfer?: Transferable[]): void;
  terminate(): void;
}
