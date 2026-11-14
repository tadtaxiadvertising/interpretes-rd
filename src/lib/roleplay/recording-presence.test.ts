import { describe, expect, it } from 'vitest';
import { hasPersistedRoleplayRecording } from './recording-presence';

describe('persisted Roleplay recording evidence', () => {
  it.each([
    { sourceAudioUrl: 'https://signed.example/old.webm' },
    { sourceAudioUrl: null, sourceAudioPath: 'responses/s/sc/source.webm' },
    { sourceAudioUrl: null, sourceAudioPath: null, processedAudioPath: 'responses/s/sc/source.mp3' },
  ])('accepts a database-stored recording reference without requiring a legacy URL', (response) => {
    expect(hasPersistedRoleplayRecording(response)).toBe(true);
  });

  it.each([
    null,
    undefined,
    {},
    { sourceAudioUrl: null, sourceAudioPath: null, processedAudioPath: null },
    { sourceAudioUrl: '  ', sourceAudioPath: '' },
  ])('rejects missing or blank references', (response) => {
    expect(hasPersistedRoleplayRecording(response)).toBe(false);
  });
});
