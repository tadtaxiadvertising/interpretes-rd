// @vitest-environment node
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { studioProductionKey, productionStatus, trackProductionTransfer, advanceProductionTransfer } from './production-tracking';

beforeAll(()=>vi.stubGlobal('crypto',webcrypto));
afterAll(()=>vi.unstubAllGlobals());
const turn={title:'Consulta',start:0,end:1,scriptPrompt:'Interpreta',responseLimit:120,speakerRole:'doctor' as const,language:'en' as const};
const source=()=>new File(['synthetic audio'],'source.wav',{type:'audio/wav'});

describe('advisory same-tab production tracking',()=>{
  it('uses stable editorial identities across reselected sources, independent of internal IDs',async()=>{
    const first={...turn,id:'one'};
    const second={...turn,id:'two'};
    const key=await studioProductionKey(source(),[first],'wav');
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(await studioProductionKey(source(),[second],'wav')).toBe(key);
    expect(await studioProductionKey(source(),[{...turn,end:2}],'wav')).not.toBe(key);
    expect(await studioProductionKey(source(),[turn],'mp3')).not.toBe(key);
    expect(await studioProductionKey(new File(['other'],'source.wav'),[turn],'wav')).not.toBe(key);
  });
  it('distinguishes transfer, verification, an uncertain attempt and confirmed creation',async()=>{
    const key=await studioProductionKey(source(),[{...turn,title:'Status fixture'}],'wav');
    trackProductionTransfer('a',key);
    expect(productionStatus(key)).toBe('transferred');
    advanceProductionTransfer('wrong','created');
    expect(productionStatus(key)).toBe('transferred');
    advanceProductionTransfer('a','verified');
    expect(productionStatus(key)).toBe('verified');
    advanceProductionTransfer('a','unconfirmed');
    expect(productionStatus(key)).toBe('unconfirmed');
    trackProductionTransfer('b',key);
    advanceProductionTransfer('b','verified');
    expect(productionStatus(key)).toBe('unconfirmed');
    advanceProductionTransfer('a','created');
    expect(productionStatus(key)).toBe('unconfirmed');
    advanceProductionTransfer('b','created');
    expect(productionStatus(key)).toBe('created');
    trackProductionTransfer('c',key);
    advanceProductionTransfer('c','verified');
    expect(productionStatus(key)).toBe('created');
  });
});
