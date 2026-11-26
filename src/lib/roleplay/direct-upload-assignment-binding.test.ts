import { describe,it,expect,vi } from 'vitest';
import { fingerprintDirectInterpreterAssignment } from './direct-upload-assignment-binding';
vi.mock('server-only',()=>({}));
const scenario={title:'Consulta',durationLimitSec:60,scriptPrompt:'Clinical prompt',studioLanguage:'en'};
const input={interpreterId:7,scenarios:[scenario,{...scenario,title:'Respuesta',studioLanguage:'es'}]};
describe('immutable assignment digest',()=>{
  it('normalizes optional nulls and key order',()=>{
    expect(fingerprintDirectInterpreterAssignment(input)).toEqual(fingerprintDirectInterpreterAssignment({
      scenarios:input.scenarios.map(s=>({sourceEndSec:null,studioSpeaker:null,...s,sourceStartSec:null,studioTurn:null})),interpreterId:7,
    }));
  });
  it('binds interpreter, scenario order and every clinical field',()=>{
    const original=fingerprintDirectInterpreterAssignment(input);
    for(const changed of [
      {...input,interpreterId:8},
      {...input,scenarios:[...input.scenarios].reverse()},
      ...[{title:'Different'},{durationLimitSec:61},{scriptPrompt:'Other prompt'},{studioLanguage:'mixed'},
        {studioTurn:1},{studioSpeaker:'speaker_1'},{sourceStartSec:0,sourceEndSec:10}].map(p=>({...input,scenarios:[{...scenario,...p},input.scenarios[1]]})),
    ]) expect(fingerprintDirectInterpreterAssignment(changed)).not.toEqual(original);
  });
});
