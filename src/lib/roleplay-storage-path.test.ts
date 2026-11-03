import { describe, expect, it } from 'vitest';
import { getBaseAudioPath, getResponseAudioPath } from '@/lib/roleplay';

describe('Roleplay storage path safety', () => {
  it('builds canonical paths for valid session identifiers', () => {
    expect(getBaseAudioPath('cksession123', 'mp3')).toBe('base/cksession123.mp3');
    expect(getResponseAudioPath('cksession123', 'webm')).toMatch(new RegExp('^responses/cksession123/[a-f0-9-]+\\.webm$'));
  });

  it.each(['', '../other', 'session/other', 'id?token=x', 'id\\\\other', 'a'.repeat(101)])(
    'rejects unsafe session identifier %s',
    sessionId => {
      expect(() => getBaseAudioPath(sessionId, 'mp3')).toThrow();
      expect(() => getResponseAudioPath(sessionId, 'mp3')).toThrow();
    },
  );

  it.each(['../mp3', 'mp3/other', ''])('rejects unsafe extension %s', extension => {
    expect(() => getBaseAudioPath('cksession123', extension)).toThrow();
  });
});
