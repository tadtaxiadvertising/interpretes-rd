// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { prepareLocalWavAssignment } from './local-wav-assignment';
import { prepareRoleplayManifestImport } from '@/lib/roleplay-manifest-import';
import { stageLocalWavHandoff, peekLocalWavHandoff, peekStudioHandoff, clearStudioHandoff } from './assignment-handoff';

function wave(seconds=5,rate=8000,channels=1) {
  const align=channels*2, size=seconds*rate*align;
  const bytes=new ArrayBuffer(44+size), view=new DataView(bytes);
  for(const [offset,word] of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']] as const)
    for(let i=0;i<4;i++)view.setUint8(offset+i,word.charCodeAt(i));
  view.setUint32(4,36+size,true);view.setUint32(16,16,true);view.setUint16(20,1,true);
  view.setUint16(22,channels,true);view.setUint32(24,rate,true);view.setUint32(28,rate*align,true);
  view.setUint16(32,align,true);view.setUint16(34,16,true);view.setUint32(40,size,true);
  for(let i=0;i<size/2;i++) view.setInt16(44+i*2,i%30000,true);
  return new File([bytes],'synthetic.wav',{type:'audio/wav'});
}
const turn={title:'Consulta',start:0.1,end:0.3,scriptPrompt:'Interpreta',responseLimit:120,
  speakerRole:'doctor' as const,language:'en' as const,caption:'Private source transcript',sourceSpeakerGroup:'speaker 1'};
const signal=()=>new AbortController().signal;
beforeAll(()=>vi.stubGlobal('crypto',webcrypto));
afterAll(()=>{clearStudioHandoff();vi.unstubAllGlobals();});
describe('local PCM assignment',()=>{
  it('copies exact PCM frames, preserves metadata and verifies SHA-256 without uploading',async()=>{
    const source=wave();
    const read=vi.spyOn(source,'arrayBuffer');
    const progress=vi.fn();
    const files=await prepareLocalWavAssignment(source,[turn],signal(),progress);
    expect(read).not.toHaveBeenCalled();
    expect(progress).toHaveBeenCalledWith(1,1);
    const raw=await files[1].arrayBuffer(), view=new DataView(raw);
    expect(view.getUint32(40,true)).toBe(3200);
    expect(view.getInt16(44,true)).toBe(800);
    expect(view.getInt16(raw.byteLength-2,true)).toBe(2399);
    const manifest=await files[0].text();
    expect(manifest).not.toContain('Private source transcript');
    expect(manifest).not.toContain('sourceSpeakerGroup');
    const imported=await prepareRoleplayManifestImport(files,{localWav:true});
    expect(imported[0]).toMatchObject({title:'Consulta',studioLanguage:'en',studioTurn:1,sourceStartSec:0.1,sourceEndSec:0.3,durationLimitSec:120});
    expect(imported[0].baseAudioFile.type).toBe('audio/wav');
    await expect(prepareRoleplayManifestImport(files)).rejects.toThrow();
    stageLocalWavHandoff('wav-token',files);
    expect(peekStudioHandoff('wav-token')).toBeNull();
    expect(peekLocalWavHandoff('wav-token')).toEqual(files);
    clearStudioHandoff('wav-token');
    expect(peekLocalWavHandoff('wav-token')).toBeNull();
  });
  it('concatenates exactly two ranges without including their gap or misleading outer timestamps',async()=>{
    const files=await prepareLocalWavAssignment(wave(),[{...turn,end:3.2,ranges:[{start:0.1,end:0.3},{start:3,end:3.2}]}],signal());
    const view=new DataView(await files[1].arrayBuffer());
    expect(view.getUint32(40,true)).toBe(6400);
    expect(view.getInt16(44+3200,true)).toBe(24000);
    const imported=await prepareRoleplayManifestImport(files,{localWav:true});
    expect(imported[0].sourceStartSec).toBeUndefined();
    expect(imported[0].sourceEndSec).toBeUndefined();
  });
  it('rejects invalid sources, original interpreter, overlapping cuts, oversized transfer and cancellation',async()=>{
    const source=wave();
    await expect(prepareLocalWavAssignment(new File(['broken'],'bad.wav'),[turn],signal())).rejects.toThrow();
    await expect(prepareLocalWavAssignment(source,[{...turn,speakerRole:'interpreter'}],signal())).rejects.toThrow();
    await expect(prepareLocalWavAssignment(source,[turn,{...turn,start:0.2,end:0.4}],signal())).rejects.toThrow();
    await expect(prepareLocalWavAssignment(wave(100,48000,2),[{...turn,start:0,end:45},{...turn,start:45,end:90}],signal())).rejects.toThrow(/presupuesto/);
    const abort=new AbortController();abort.abort();
    await expect(prepareLocalWavAssignment(source,[turn],abort.signal)).rejects.toThrow();
  });
  it('rejects tampered audio during manifest import',async()=>{
    const files=await prepareLocalWavAssignment(wave(),[turn],signal());
    const changed=await files[1].arrayBuffer();new Uint8Array(changed)[45]^=1;
    await expect(prepareRoleplayManifestImport([files[0],new File([changed],files[1].name,{type:'audio/wav'})],{localWav:true})).rejects.toThrow(/SHA-256/);
  });
});
