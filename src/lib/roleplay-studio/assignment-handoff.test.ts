// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stageStudioHandoff, peekStudioHandoff, clearStudioHandoff, stageLocalWavHandoff, peekStudioHandoffTopic } from './assignment-handoff';
const file = () => new File(['x'.repeat(22)], 'roleplay-studio.zip', { type: 'application/zip' });
afterEach(() => { clearStudioHandoff(); vi.useRealTimers(); });
describe('ephemeral Studio handoff', () => {
  it('matches only the supplied token, clears on consumption, and replaces older transfers', () => {
    const a = file(), b = file();
    stageStudioHandoff('first', a);
    expect(peekStudioHandoff('first')).toBe(a);
    expect(peekStudioHandoff('other')).toBeNull();
    stageStudioHandoff('second', b);
    clearStudioHandoff('first');
    expect(peekStudioHandoff('first')).toBeNull();
    expect(peekStudioHandoff('second')).toBe(b);
    clearStudioHandoff('second');
    expect(peekStudioHandoff('second')).toBeNull();
  });
  it('keeps a validated topic scoped to the same token, consumption and expiry', () => {
    vi.useFakeTimers();
    const selection = { topic: 'medical', subtopic: 'pharmacy' };
    stageStudioHandoff('topic', file(), selection);
    expect(peekStudioHandoffTopic('topic')).toEqual(selection);
    expect(peekStudioHandoffTopic('other')).toBeNull();
    selection.subtopic = 'consultation';
    expect(peekStudioHandoffTopic('topic')?.subtopic).toBe('pharmacy');
    const peeked = peekStudioHandoffTopic('topic')!;
    peeked.subtopic = 'consultation';
    expect(peekStudioHandoffTopic('topic')?.subtopic).toBe('pharmacy');
    stageStudioHandoff('next', file(), { topic: 'medical', subtopic: 'claims' });
    expect(peekStudioHandoffTopic('topic')).toBeNull();
    expect(peekStudioHandoffTopic('next')).toBeNull();
    stageStudioHandoff('expiry', file(), selection);
    vi.advanceTimersByTime(300001);
    expect(peekStudioHandoffTopic('expiry')).toBeNull();
  });
  it('also transfers a topic with local WAV files and clears it on consumption', () => {
    const files = [new File(['{}'], 'manifest.json'), new File(['x'.repeat(45)], 'segment-01.wav', { type: 'audio/wav' })];
    stageLocalWavHandoff('wav', files, { topic: 'finance', subtopic: 'banking' });
    expect(peekStudioHandoffTopic('wav')).toEqual({ topic: 'finance', subtopic: 'banking' });
    clearStudioHandoff('wav');
    expect(peekStudioHandoffTopic('wav')).toBeNull();
  });
  it('expires and rejects malformed transfer metadata', () => {
    vi.useFakeTimers();
    stageStudioHandoff('temporary', file());
    vi.advanceTimersByTime(300001);
    expect(peekStudioHandoff('temporary')).toBeNull();
    expect(() => stageStudioHandoff('invalid/token', file())).toThrow();
    expect(() => stageStudioHandoff('valid', new File(['x'], 'roleplay-studio.zip'))).toThrow();
  });
});
