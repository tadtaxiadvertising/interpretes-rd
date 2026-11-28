import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { ComponentProps } from 'react';
import '@/app/globals.css';
import FocusTimeline from '@/app/admin/roleplays/studio/FocusTimeline';
import StudioWaveform from '@/app/admin/roleplays/studio/StudioWaveform';
import StudioFocusNavigation from '@/app/admin/roleplays/studio/StudioFocusNavigation';
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
const focusScenario = new URLSearchParams(location.search).has('focus');
const visibleSegments = active.map((segment, index) => ({ segment, index }));
let focusIndex = 1;
let previewActive = false;
let listenAfterConfirm = false;
const selectFocus = (id: string) => {
  const index = visibleSegments.findIndex(item => item.segment.id === id);
  if (index >= 0) { focusIndex = index; previewActive = false; renderProject(); }
};
const advanceFocus = () => {
  const next = visibleSegments[focusIndex + 1];
  if (next) selectFocus(next.segment.id);
};
const togglePreview = () => { previewActive = !previewActive; renderProject(); };
const pausePreview = () => { previewActive = false; renderProject(); };
const seekFocus = (value: number) => { position = Math.max(0, Math.min(duration, value)); renderProject(); };

function renderProject() {
  flushSync(() => root.render(<>
    {focusScenario && <StudioFocusNavigation visibleSegments={visibleSegments} focusedTurn={visibleSegments[focusIndex]}
      focusIndex={focusIndex} totalTurns={count} workspaceActive canConfirmFocused editingDisabled={false}
      confirmed={false} focusedReviewIssue={null} sourceProfileCount={2} previewActive={previewActive}
      playhead={position} duration={duration} onFocusCard={onSelect}
      listenAfterConfirm={listenAfterConfirm} onListenAfterConfirmChange={enabled => { listenAfterConfirm = enabled; renderProject(); }}
      onSelect={selectFocus} onConfirm={advanceFocus}
      onExclude={advanceFocus} onApplyProfile={onSelect} onPreview={togglePreview} onPause={pausePreview}
      onSkip={seconds => seekFocus(position + seconds)} onSeek={seekFocus}/>}

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
