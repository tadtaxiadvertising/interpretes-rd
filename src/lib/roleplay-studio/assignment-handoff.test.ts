// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stageStudioHandoff, peekStudioHandoff, clearStudioHandoff } from './assignment-handoff';
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
  it('expires and rejects malformed transfer metadata', () => {
    vi.useFakeTimers();
    stageStudioHandoff('temporary', file());
    vi.advanceTimersByTime(300001);
    expect(peekStudioHandoff('temporary')).toBeNull();
    expect(() => stageStudioHandoff('invalid/token', file())).toThrow();
    expect(() => stageStudioHandoff('valid', new File(['x'], 'roleplay-studio.zip'))).toThrow();
  });
});
