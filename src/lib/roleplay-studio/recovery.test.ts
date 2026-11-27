import { describe, expect, it } from 'vitest';
import { createStudioRecovery, openStudioRecovery, updateRecoveryProduction, mergeProductionReceipts } from './recovery';

const hash = 'ab'.repeat(32);
const turns = Array.from({ length: 30 }, (_, i) => ({
  id: 'turn-' + i, title: 'Intervención ' + (i + 1), start: i * 3, end: i * 3 + 2,
  scriptPrompt: '', responseLimit: 120, speakerRole: 'doctor' as const, language: 'en' as const,
  sourceSpeakerGroup: 'speaker 1', caption: 'Private reference', audio: 'blob:secret',
}));
describe('local Studio recovery', () => {
  it('restores extended projects and confirmation indices without private references or source labels', () => {
    const raw = createStudioRecovery(300, hash, 120, turns, new Set(['turn-0','turn-28']), 'turn-29', 87);
    const restored = openStudioRecovery(raw, 300, hash, 120);
    expect(restored.segments).toHaveLength(30);
    expect([...restored.confirmed]).toEqual([0,28]);
    expect(restored.active).toBe(29);
    expect(restored.playhead).toBe(87);
    for (const privateValue of ['Private reference','sourceSpeakerGroup','blob:secret','turn-29']) {
      expect(raw).not.toContain(privateValue);
    }
  });
  it('refuses wrong recordings and malformed progress without silently resetting work', () => {
    const raw = createStudioRecovery(300, hash, 120, turns, new Set(), undefined, 0);
    expect(() => openStudioRecovery(raw, 301, hash, 120)).toThrow();
    expect(() => openStudioRecovery(raw, 300, 'cd'.repeat(32), 120)).toThrow();
    expect(() => openStudioRecovery(raw, 300, hash, 121)).toThrow();
    expect(() => openStudioRecovery(JSON.stringify({ ...JSON.parse(raw), confirmed: [30] }), 300, hash, 120)).toThrow();
    expect(() => openStudioRecovery(JSON.stringify({ ...JSON.parse(raw), active: 30 }), 300, hash, 120)).toThrow();
    expect(() => createStudioRecovery(300, hash, 120, [{ ...turns[0], title: '' }], new Set(), undefined, 0)).toThrow();
  });
  it('round-trips opaque durable receipts and never downgrades a confirmed creation', () => {
    const key = '12'.repeat(32);
    const raw = createStudioRecovery(300, hash, 120, turns, new Set(), undefined, 0);
    expect(openStudioRecovery(raw, 300, hash, 120).production).toEqual([]);
    const pending = updateRecoveryProduction(raw, {key,status:'unconfirmed'});
    const confirmed = updateRecoveryProduction(pending, {key,status:'created'});
    const repeated = updateRecoveryProduction(confirmed, {key,status:'unconfirmed'});
    expect(openStudioRecovery(repeated, 300, hash, 120).production).toEqual([{key,status:'created'}]);
    const strip = (value:string) => {const parsed=JSON.parse(value);delete parsed.production;return parsed;};
    expect(strip(repeated)).toEqual(strip(raw));
    expect(mergeProductionReceipts([{key,status:'created'}],[{key,status:'unconfirmed'}])).toEqual([{key,status:'created'}]);
  });
  it('rejects malformed, duplicate, transient and oversized production records', () => {
    const raw = createStudioRecovery(300, hash, 120, turns, new Set(), undefined, 0);
    const key='45'.repeat(32);
    for (const production of [
      [{key:'invalid',status:'created'}], [{key,status:'verified'}],
      [{key,status:'created'},{key,status:'unconfirmed'}],
      Array.from({length:101},(_,i)=>({key:i.toString(16).padStart(64,'0'),status:'created'})),
    ]) {
      expect(()=>openStudioRecovery(JSON.stringify({...JSON.parse(raw),production}),300,hash,120)).toThrow(/producción/);
    }
    const bounded=mergeProductionReceipts([],Array.from({length:101},(_,i)=>({key:i.toString(16).padStart(64,'0'),status:'created' as const})));
    expect(bounded).toHaveLength(100);
    expect(bounded[0].key).toBe('1'.padStart(64,'0'));
  });
  it('supports empty projects and bounds playback position', () => {
    const raw = createStudioRecovery(300, hash, 120, [], new Set(), undefined, 200);
    expect(openStudioRecovery(raw, 300, hash, 120)).toMatchObject({ segments: [], active: -1, playhead: 120 });
  });
});
