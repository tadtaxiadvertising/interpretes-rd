import { attachWhisperTinyWorker } from './whisper-tiny-runtime';
import type { WhisperWorkerPort } from './whisper-tiny-protocol';

// Browser-only module Worker. It cannot read the microphone directly.
// Model weights download only after receiving the user's explicit 'load'.
attachWhisperTinyWorker(self as unknown as WhisperWorkerPort);
