// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fingerprintLocalMedia } from '@/lib/roleplay-studio/long-media';
import { createStudioRecovery, openStudioRecovery, STUDIO_RECOVERY_KEY } from '@/lib/roleplay-studio/recovery';
import { useStudioLocalRecovery } from './useStudioLocalRecovery';
import type { StudioIntervention } from './StudioInterventionCard';

const hash = 'ab'.repeat(32);
vi.mock('@/lib/roleplay-studio/long-media', async () => ({
  ...await vi.importActual<typeof import('@/lib/roleplay-studio/long-media')>('@/lib/roleplay-studio/long-media'),
  fingerprintLocalMedia: vi.fn(async () => hash),
}));

const turn: StudioIntervention = {id:'a',title:'Consulta',start:0,end:2,scriptPrompt:'',responseLimit:60,speakerRole:'doctor',language:'en'};

function setup() {
  const audio = new File(['ID3'], 'fixture.mp3', {type:'audio/mpeg'});
  const options = {
    audio, duration:90, segments:[turn], excludedTurns:[], confirmedIds:new Set(['a']),
    workspaceTurnId:'a', activeProductionKeys:null, activeAudioFile:{current:audio as File | null},
    editorRevision:{current:0}, player:{current:null}, disabled:false, hasActiveEditorWork:false,
    onRestore:vi.fn(),
  };
  return {options,...renderHook(()=>useStudioLocalRecovery(options))};
}

describe('local recovery coordinator',()=>{
  beforeEach(()=>{
    localStorage.clear();
    vi.mocked(fingerprintLocalMedia).mockReset();
    vi.mocked(fingerprintLocalMedia).mockResolvedValue(hash);
    vi.spyOn(window,'confirm').mockReturnValue(true);
  });
  afterEach(()=>{
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('writes only after opt-in and pauses without deleting a valid backup',async()=>{
    const {result,options}=setup();
    expect(localStorage.getItem(STUDIO_RECOVERY_KEY)).toBeNull();
    await act(async()=>{await result.current.startRecovery(false);});
    let raw: string | undefined;
    act(()=>{raw=result.current.flushRecovery.current?.();});
    expect(raw).toBeTruthy();
    expect(openStudioRecovery(raw!,options.audio.size,hash,90).confirmed.has(0)).toBe(true);
    act(()=>result.current.pauseRecovery());
    expect(result.current.recoveryEnabled).toBe(false);
    expect(localStorage.getItem(STUDIO_RECOVERY_KEY)).toBe(raw);
  });

  it('does not overwrite a changed backup',async()=>{
    const {result}=setup();
    await act(async()=>{await result.current.startRecovery(false);});
    localStorage.setItem(STUDIO_RECOVERY_KEY,'newer snapshot');
    act(()=>{result.current.flushRecovery.current?.();});
    expect(localStorage.getItem(STUDIO_RECOVERY_KEY)).toBe('newer snapshot');
    expect(result.current.recoveryEnabled).toBe(false);
    expect(result.current.recoveryStatus).toMatch(/otra pestaña/);
  });

  it.each(['source','unmount'] as const)('ignores a delayed recovery after %s invalidation',async(mode)=>{
    let resolve!: (value:string)=>void;
    vi.mocked(fingerprintLocalMedia).mockReturnValueOnce(new Promise(r=>{resolve=r;}));
    const {result,options,unmount}=setup();
    localStorage.setItem(STUDIO_RECOVERY_KEY,createStudioRecovery(options.audio.size,hash,90,[turn],new Set(),'a',0));
    let pending!: Promise<void>;
    act(()=>{pending=result.current.startRecovery(true);});
    if(mode==='source'){
      act(()=>{
        options.activeAudioFile.current=null;
        result.current.resetRecoveryForSource();
      });
    }else unmount();
    await act(async()=>{resolve(hash);await pending;});
    expect(options.onRestore).not.toHaveBeenCalled();
  });
});
