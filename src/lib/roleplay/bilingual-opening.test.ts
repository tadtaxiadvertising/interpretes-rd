import { describe, expect, it } from 'vitest';
import { getBilingualOpeningState, isCanonicalBilingualOpeningPath } from './bilingual-opening';

const sessionId = 'session-1';
const path = 'openings/session-1/123e4567-e89b-42d3-a456-426614174000.webm';
const recording = { sourceAudioPath: path, durationSec: 42, confirmedAt: new Date('2026-11-25T00:00:00Z') };

describe('bilingual opening contract', () => {
  it('keeps old sessions exempt and requires evidence for opted-in sessions', () => {
    expect(getBilingualOpeningState(sessionId, false, null)).toBe('not-required');
    expect(getBilingualOpeningState(sessionId, true, null)).toBe('pending');
    expect(getBilingualOpeningState(sessionId, true, recording)).toBe('confirmed');
  });

  it('rejects cross-session and scenario response paths, URLs and traversal', () => {
    for (const invalid of [path.replace('session-1', 'session-2'),
      path.replace('openings', 'responses'), 'https://storage.test/' + path,
      path.replace('session-1', '../session-1'), path + '?token=abc', path + '\n']) {
      expect(isCanonicalBilingualOpeningPath(invalid, sessionId)).toBe(false);
      expect(getBilingualOpeningState(sessionId, true, { ...recording, sourceAudioPath: invalid })).toBe('pending');
    }
  });

  it('does not accept invalid confirmation timestamps or durations', () => {
    for (const durationSec of [0, -1, 301, 1.5, NaN]) {
      expect(getBilingualOpeningState(sessionId, true, { ...recording, durationSec })).toBe('pending');
    }
    expect(getBilingualOpeningState(sessionId, true, { ...recording, confirmedAt: new Date(NaN) })).toBe('pending');
  });
});
