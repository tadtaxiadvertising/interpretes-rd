import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { ComponentProps } from 'react';
import '@/app/globals.css';
import FocusTimeline from '@/app/admin/roleplays/studio/FocusTimeline';
import StudioWaveform from '@/app/admin/roleplays/studio/StudioWaveform';
import { STUDIO_MAX_EDITOR_SEGMENTS } from '@/lib/roleplay-studio/draft';
import { MAX_LOCAL_MEDIA_SECONDS } from '@/lib/roleplay-studio/long-media';

type Turn = ComponentProps<typeof FocusTimeline>['active'][number];
export type BenchmarkSample = {
  ticks: number;
  intervalReads: number;
  mediaReads: number;
  commitMs: number[];
  frameIntervalMs: number[];
  finalPosition: number;
};

declare global {
  interface Window {
    runStudioBenchmark: (ticks: number) => Promise<BenchmarkSample>;
  }
}

const duration = MAX_LOCAL_MEDIA_SECONDS;
const count = STUDIO_MAX_EDITOR_SEGMENTS;
let intervalReads = 0;
let mediaReads = 0;
let position = duration / 2;
const contrastScenario = new URLSearchParams(location.search).has('contrast');
const speakerRoles: Turn['speakerRole'][] = ['doctor', 'patient', 'nurse', 'operator', 'interpreter', 'unknown'];
const active: Turn[] = Array.from({ length: count }, (_, index) => {
  const start = 10 + index * Math.floor(duration / count);
  return {
    id: 'turn-' + index,
    title: 'Intervención ' + (index + 1),
    get start() { intervalReads++; return start; },
    end: start + 5,
    speakerRole: contrastScenario ? speakerRoles[index % speakerRoles.length] : index % 2 === 0 ? 'doctor' : 'patient',
  };
});
const excluded: Turn[] = contrastScenario ? [{ id: 'excluded-test', start: 60, end: 65, title: 'Corte excluido de prueba', speakerRole: 'interpreter' }] : [];
const file = new File(['synthetic metadata fixture'], 'long.mp4', { type: 'video/mp4' });
Object.defineProperty(file, 'arrayBuffer', {
  value: async () => { mediaReads++; return new ArrayBuffer(0); },
});
const onSelect = () => {};
const onSeek = () => {};
const root = createRoot(document.getElementById('root')!);

function renderProject() {
  flushSync(() => root.render(<>
    <StudioWaveform file={file} duration={duration} currentTime={position} segments={active} onSeek={onSeek}/>
    <FocusTimeline duration={duration} playhead={position} active={active} excluded={excluded}
      selectedId={active[0].id} onSelect={onSelect} onSeek={onSeek}/>
  </>));
}

const nextFrame = () => new Promise<number>(resolve => requestAnimationFrame(resolve));
renderProject();
let running = false;
window.runStudioBenchmark = async (ticks) => {
  if (running || !Number.isInteger(ticks) || ticks < 1 || ticks > 256) throw new Error('Invalid benchmark request');
  running = true;
  try {
    intervalReads = 0;
    const initialMediaReads = mediaReads;
    const commitMs: number[] = [];
    const frameIntervalMs: number[] = [];
    let frame = await nextFrame();
    for (let tick = 0; tick < ticks; tick++) {
      position += 0.25;
      const start = performance.now();
      renderProject();
      commitMs.push(performance.now() - start);
      const next = await nextFrame();
      frameIntervalMs.push(next - frame);
      frame = next;
    }
    return { ticks, intervalReads, mediaReads: mediaReads - initialMediaReads, commitMs, frameIntervalMs, finalPosition: position };
  } finally {
    running = false;
  }
};
