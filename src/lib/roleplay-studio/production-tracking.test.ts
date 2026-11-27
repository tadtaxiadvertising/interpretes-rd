// @vitest-environment node
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { studioProductionKey, productionStatus, trackProductionTransfer, advanceProductionTransfer, restoreProductionReceipts, productionReceipts } from './production-tracking';
import { STUDIO_RECOVERY_KEY, createStudioRecovery, openStudioRecovery } from './recovery';

beforeAll(()=>vi.stubGlobal('crypto',webcrypto));
afterAll(()=>vi.unstubAllGlobals());
const turn={title:'Consulta',start:0,end:1,scriptPrompt:'Interpreta',responseLimit:120,speakerRole:'doctor' as const,language:'en' as const};
const source=()=>new File(['synthetic audio'],'source.wav',{type:'audio/wav'});

describe('advisory same-tab production tracking',()=>{
  it('does not read a source without Web Crypto digest support',async()=>{
    const file=source();
    const read=vi.spyOn(file,'slice');
    vi.stubGlobal('crypto',{});
    try {
      await expect(studioProductionKey(file,[turn],'wav')).rejects.toThrow(/HTTPS/);
      expect(read).not.toHaveBeenCalled();
    } finally { vi.stubGlobal('crypto',webcrypto); }
  });
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
  it('persists only durable receipts on the exact consented backup, without recreating deleted backups',()=>{
    const hash='ab'.repeat(32), key='22'.repeat(32), second='33'.repeat(32);
    const raw=createStudioRecovery(300,hash,120,[{...turn,id:'a'}],new Set(),undefined,0);
    const storage=new Map([[STUDIO_RECOVERY_KEY,raw]]);
    const setItem=vi.fn((name:string,value:string)=>{storage.set(name,value);});
    vi.stubGlobal('localStorage',{getItem:(name:string)=>storage.get(name)??null,setItem});
    trackProductionTransfer('persistent',key,raw);
    advanceProductionTransfer('persistent','verified');
    expect(setItem).not.toHaveBeenCalled();
    expect(advanceProductionTransfer('persistent','unconfirmed')).toBe('saved');
    expect(openStudioRecovery(storage.get(STUDIO_RECOVERY_KEY)!,300,hash,120).production).toEqual([{key,status:'unconfirmed'}]);
    expect(advanceProductionTransfer('persistent','created')).toBe('saved');
    expect(openStudioRecovery(storage.get(STUDIO_RECOVERY_KEY)!,300,hash,120).production).toEqual([{key,status:'created'}]);
    trackProductionTransfer('deleted',second,storage.get(STUDIO_RECOVERY_KEY));
    storage.delete(STUDIO_RECOVERY_KEY);
    expect(advanceProductionTransfer('deleted','unconfirmed')).toBe('backup-changed');
    expect(advanceProductionTransfer('deleted','created')).toBe('backup-changed');
    expect(storage.has(STUDIO_RECOVERY_KEY)).toBe(false);
    expect(productionStatus(second)).toBe('created');
    expect(setItem).toHaveBeenCalledTimes(2);
    storage.set(STUDIO_RECOVERY_KEY,raw);
    trackProductionTransfer('no-consent','44'.repeat(32));
    advanceProductionTransfer('no-consent','created');
    expect(storage.get(STUDIO_RECOVERY_KEY)).toBe(raw);
    expect(setItem).toHaveBeenCalledTimes(2);
  });
  it('restores durable receipts without importing transient states or downgrading confirmation',()=>{
    const key='55'.repeat(32), other='66'.repeat(32);
    restoreProductionReceipts([{key,status:'created'},{key:other,status:'unconfirmed'}]);
    restoreProductionReceipts([{key,status:'unconfirmed'}]);
    expect(productionReceipts([key,other,'77'.repeat(32)])).toEqual([{key,status:'created'},{key:other,status:'unconfirmed'}]);
  });

});
