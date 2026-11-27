import { describe, expect, it } from 'vitest';
import { filterHappyScribeLibrary, happyScribeResultPage, happyScribeProofExpiry, type HappyScribeLibraryItem } from './happyscribe-library';
const item=(id:string, fields: Partial<HappyScribeLibraryItem>={}): HappyScribeLibraryItem=>({
  id,name:'Consulta médica',folder:'Evaluación',state:'done',language:'es',createdAt:null,durationSeconds:90,importProof:'',...fields,
});
describe('HappyScribe local catalog search',()=>{
  it('matches accent-insensitive terms across fields and combines exact filters',()=>{
    const items=[item('a'),item('b',{state:'processing'}),item('c',{language:'en'}),item('d',{folder:'Otra'})];
    expect(filterHappyScribeLibrary(items,{query:'medica evaluacion',readyOnly:true,language:'es',folder:'Evaluación'}).map(x=>x.id)).toEqual(['a']);
    expect(filterHappyScribeLibrary(items,{query:'unknown',readyOnly:false,language:'',folder:''})).toEqual([]);
  });
  it('bounds options and pins a selection outside the current page',()=>{
    const items=Array.from({length:51},(_,i)=>item(String(i)));
    const result=happyScribeResultPage(items,1,items[0]);
    expect(result.results).toHaveLength(20);
    expect(result.results[0].id).toBe('20');
    expect(result.pinned).toBe(items[0]);
    expect(happyScribeResultPage(items,99).results).toHaveLength(11);
    expect(happyScribeResultPage(items,0,items[0]).pinned).toBeUndefined();
    expect(happyScribeResultPage([],0,items[0]).pinned).toBe(items[0]);
  });
  it('reads only the expiry hint of a well-formed proof',()=>{
    expect(happyScribeProofExpiry('1800000000000.'+'a'.repeat(64))).toBe(1800000000000);
    expect(happyScribeProofExpiry('invalid')).toBeNull();
    expect(happyScribeProofExpiry(undefined)).toBeNull();
  });
});
