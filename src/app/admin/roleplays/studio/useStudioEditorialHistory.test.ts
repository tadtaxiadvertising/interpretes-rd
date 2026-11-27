// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useStudioEditorialHistory, hasRecoverableUndo, type EditorialSnapshot } from './useStudioEditorialHistory';
import type { StudioIntervention } from './StudioInterventionCard';

afterEach(cleanup);
const turn: StudioIntervention = {id:'a', title:'Consulta',start:0,end:2,scriptPrompt:'',responseLimit:60,speakerRole:'doctor',language:'en'};
const snapshot = (title:string): EditorialSnapshot => ({
  kind:'edición de intervención', segments:[{...turn,title}], captions:{a:'Referencia privada'},expandedId:'a',
});
describe('editorial history coordinator',()=>{
  it('groups successive edits of the same field and resets grouping after undo',()=>{
    const {result}=renderHook(()=>useStudioEditorialHistory([],new Map()));
    act(()=>result.current.rememberGroupedEdit('a:title',snapshot('A'),1000));
    act(()=>result.current.rememberGroupedEdit('a:title',snapshot('AB'),1500));
    expect(result.current.history.past).toHaveLength(1);
    act(()=>result.current.rememberGroupedEdit('a:title',snapshot('ABC'),2300));
    expect(result.current.history.past).toHaveLength(2);
    act(()=>result.current.stepHistory(snapshot('ABCD'),'undo'));
    expect(result.current.nextStructuralEdit?.segments[0].title).toBe('ABCD');
    act(()=>result.current.rememberGroupedEdit('a:title',snapshot('ABC'),2400));
    expect(result.current.history.future).toHaveLength(0);
    expect(result.current.lastStructuralEdit?.segments[0].title).toBe('ABC');
  });
  it('captures current excluded turns and confirmation snapshots and clears history',()=>{
    const excluded=[{turn,caption:'Private'}], confirmations=new Map([[turn.id,turn]]);
    const {result}=renderHook(()=>useStudioEditorialHistory(excluded,confirmations));
    act(()=>result.current.rememberEdit(snapshot('Before')));
    expect(result.current.lastStructuralEdit?.excluded).toBe(excluded);
    expect(result.current.lastStructuralEdit?.confirmations).toBe(confirmations);
    expect(hasRecoverableUndo(result.current.lastStructuralEdit)).toBe(true);
    act(()=>result.current.clearEditorialHistory());
    expect(result.current.history).toEqual({past:[],future:[]});
    expect(hasRecoverableUndo(result.current.lastStructuralEdit)).toBe(false);
  });
  it('scrubs remote suggestions from both stacks without discarding prior cuts',()=>{
    const {result}=renderHook(()=>useStudioEditorialHistory([],new Map()));
    const before={...snapshot('Before'),previousSuggestions:{silences:[],clips:[],omittedCount:2}};
    act(()=>result.current.rememberEdit(before));
    act(()=>result.current.rememberEdit(before));
    act(()=>result.current.stepHistory({...before,segments:[{...turn,title:'After'}]},'undo'));
    act(()=>result.current.forgetServerSuggestions());
    expect([...result.current.history.past,...result.current.history.future].every(s=>s.previousSuggestions===undefined)).toBe(true);
    expect(result.current.nextStructuralEdit?.segments[0].title).toBe('After');
  });
});
