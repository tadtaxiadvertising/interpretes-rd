import { attachLocalAsrAudioWorker } from './local-asr-worker-runtime';
import type { LocalAsrWorkerEndpoint } from './local-asr-worker-protocol';

// Bundled as a dedicated same-origin module Worker by Next/Webpack.
// No model download or network request is performed by this entrypoint.
attachLocalAsrAudioWorker(self as unknown as LocalAsrWorkerEndpoint);
