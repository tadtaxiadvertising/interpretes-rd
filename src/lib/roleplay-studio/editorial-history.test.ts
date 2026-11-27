import { describe, expect, it } from 'vitest';
import { emptyStudioHistory, rememberStudioEdit, stepStudioHistory, mapStudioHistory, STUDIO_HISTORY_LIMIT } from './editorial-history';
describe('bounded editorial history',()=>{
  it('supports multiple undo and redo operations and discards redo after a new edit',()=>{
    let h=emptyStudioHistory<string>();
    h=rememberStudioEdit(h,'A');h=rememberStudioEdit(h,'B');
    h=stepStudioHistory(h,'C','undo');
    expect(h).toEqual({past:['A'],future:['C']});
    h=stepStudioHistory(h,'B','undo');
    expect(h).toEqual({past:[],future:['C','B']});
    h=stepStudioHistory(h,'A','redo');
    expect(h).toEqual({past:['A'],future:['C']});
    h=rememberStudioEdit(h,'B');
    expect(h).toEqual({past:['A','B'],future:[]});
  });
  it('bounds the stack and can scrub revoked metadata from both directions',()=>{
    let h=emptyStudioHistory<{index:number;privatePause?: string}>();
    for(let i=0;i<STUDIO_HISTORY_LIMIT+2;i++)h=rememberStudioEdit(h,{index:i,privatePause:'pause'});
    expect(h.past).toHaveLength(STUDIO_HISTORY_LIMIT);
    expect(h.past[0].index).toBe(2);
    h=stepStudioHistory(h,{index:99,privatePause:'pause'},'undo');
    h=mapStudioHistory(h,({index})=>({index}));
    expect([...h.past,...h.future].every(x=>x.privatePause===undefined)).toBe(true);
  });
});
