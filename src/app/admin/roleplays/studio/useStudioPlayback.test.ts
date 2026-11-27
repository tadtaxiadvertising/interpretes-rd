// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SyntheticEvent } from 'react';
import { useStudioPlayback } from './useStudioPlayback';
import type { StudioIntervention } from './StudioInterventionCard';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const turn: StudioIntervention = {id:'a',title:'Consulta',start:1,end:4,scriptPrompt:'',responseLimit:60,speakerRole:'doctor',language:'en'};
function setup() {
  const setDuration = vi.fn(), setError = vi.fn();
  const primary = document.createElement('audio'), pair = document.createElement('audio');
  const primaryPlay = vi.spyOn(primary,'play').mockResolvedValue(undefined);
  const primaryPause = vi.spyOn(primary,'pause').mockImplementation(()=>{});
  const pairPlay = vi.spyOn(pair,'play').mockResolvedValue(undefined);
  const pairPause = vi.spyOn(pair,'pause').mockImplementation(()=>{});
  const view = renderHook(()=>useStudioPlayback(90,setDuration,setError));
  act(()=>{
    view.result.current.attachPlayer(primary);
    view.result.current.pairPlayer.current=pair;
  });
  return {...view,primary,pair,primaryPlay,primaryPause,pairPlay,pairPause,setError,setDuration};
}
const event = (element: HTMLAudioElement) => ({currentTarget:element}) as SyntheticEvent<HTMLAudioElement>;
describe('studio playback coordinator',()=>{
  it('ignores a retired play rejection and stops the current clip at its own end',async()=>{
    const {result,primary,primaryPlay,primaryPause,setError}=setup();
    let reject!: (reason: Error)=>void;
    primaryPlay.mockReturnValueOnce(new Promise<void>((_,fail)=>{reject=fail;}));
    act(()=>result.current.previewSimpleSegment(turn));
    act(()=>result.current.previewSimpleSegment({...turn,id:'b',start:8,end:12}));
    await act(async()=>{reject(new Error('old request'));await Promise.resolve();});
    expect(result.current.previewingId).toBe('b');
    expect(setError).not.toHaveBeenCalled();
    act(()=>{primary.currentTime=12;result.current.mediaHandlers.onTimeUpdate(event(primary));});
    expect(primaryPause).toHaveBeenCalledOnce();
    expect(result.current.previewingId).toBeNull();
  });
  it('manual seeking clears a previous cutoff and clamps the cursor',()=>{
    const {result,primary,primaryPause}=setup();
    act(()=>result.current.previewSimpleSegment(turn));
    act(()=>result.current.seekAudio(120));
    expect(primary.currentTime).toBe(90);
    expect(result.current.playhead).toBe(90);
    expect(result.current.previewingId).toBeNull();
    act(()=>result.current.mediaHandlers.onTimeUpdate(event(primary)));
    expect(primaryPause).not.toHaveBeenCalled();
  });
  it('jumps across a compound gap and stops only after the second interval',()=>{
    const {result,pair,pairPlay,pairPause,primaryPause}=setup();
    const plan={first:{start:1,end:4},second:{start:10,end:13},skippedSeconds:6,selectedSeconds:6};
    const started=vi.fn(),failed=vi.fn();
    act(()=>result.current.startPairPreview('a',plan,started,failed));
    expect(primaryPause).toHaveBeenCalledOnce();
    expect(pair.currentTime).toBe(1);
    expect(pairPlay).toHaveBeenCalledOnce();
    expect(started).toHaveBeenCalledOnce();
    act(()=>{pair.currentTime=4;result.current.pairMediaHandlers.onTimeUpdate(event(pair));});
    expect(pair.currentTime).toBe(10);
    expect(pairPause).not.toHaveBeenCalled();
    act(()=>{pair.currentTime=13;result.current.pairMediaHandlers.onTimeUpdate(event(pair));});
    expect(pairPause).toHaveBeenCalledOnce();
    expect(result.current.pairPreviewId).toBeNull();
    expect(failed).not.toHaveBeenCalled();
  });
  it('stops the compound preview when the primary native controls resume playback',async()=>{
    const {result,primary,pairPlay,pairPause}=setup();
    const plan={first:{start:1,end:4},second:{start:10,end:13},skippedSeconds:6,selectedSeconds:6};
    const failed=vi.fn();
    let reject!: (reason: Error)=>void;
    pairPlay.mockReturnValueOnce(new Promise<void>((_,fail)=>{reject=fail;}));
    act(()=>result.current.startPairPreview('a',plan,vi.fn(),failed));
    vi.spyOn(primary,'paused','get').mockReturnValue(false);
    act(()=>result.current.mediaHandlers.onPlay(event(primary)));
    expect(pairPause).toHaveBeenCalledOnce();
    expect(result.current.pairPreviewId).toBeNull();
    await act(async()=>{reject(new Error('retired pair'));await Promise.resolve();});
    expect(failed).not.toHaveBeenCalled();
  });
  it('does not stop a new compound preview for an obsolete primary play event',()=>{
    const {result,primary,pairPause}=setup();
    const plan={first:{start:1,end:4},second:{start:10,end:13},skippedSeconds:6,selectedSeconds:6};
    act(()=>result.current.startPairPreview('a',plan,vi.fn(),vi.fn()));
    const revision=result.current.editorPlaybackRevision;
    vi.spyOn(primary,'paused','get').mockReturnValue(true);
    act(()=>result.current.mediaHandlers.onPlay(event(primary)));
    const detached=document.createElement('audio');
    vi.spyOn(detached,'paused','get').mockReturnValue(false);
    act(()=>result.current.mediaHandlers.onPlay(event(detached)));
    expect(result.current.pairPreviewId).toBe('a');
    expect(result.current.editorPlaybackRevision).toBe(revision);
    expect(pairPause).not.toHaveBeenCalled();
  });
  it('does not pause an idle auxiliary player during ordinary native playback',()=>{
    const {result,primary,pairPause}=setup();
    vi.spyOn(primary,'paused','get').mockReturnValue(false);
    const revision=result.current.editorPlaybackRevision;
    act(()=>result.current.mediaHandlers.onPlay(event(primary)));
    expect(result.current.editorPlaybackRevision).toBe(revision+1);
    expect(pairPause).not.toHaveBeenCalled();
  });
  it('invalidates a pending rejection on unmount',async()=>{
    const {result,primaryPlay,setError,unmount}=setup();
    let reject!: (reason: Error)=>void;
    primaryPlay.mockReturnValueOnce(new Promise<void>((_,fail)=>{reject=fail;}));
    act(()=>result.current.previewSimpleSegment(turn));
    unmount();
    await act(async()=>{reject(new Error('retired'));await Promise.resolve();});
    expect(setError).not.toHaveBeenCalled();
  });
});
