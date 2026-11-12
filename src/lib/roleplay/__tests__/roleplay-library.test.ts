import { describe, expect, it } from 'vitest';
import { getReusableBaseAudioPath, getRoleplaySnapshotHash } from '@/lib/roleplay-library';

const supabaseUrl = 'https://example.supabase.co';
const publicBase = `${supabaseUrl}/storage/v1/object/public/roleplay-audio/base`;

describe('getReusableBaseAudioPath', () => {
  it('accepts an existing base audio path in the project bucket', () => {
    expect(getReusableBaseAudioPath(`${publicBase}/bulk-123/0.mp3`, supabaseUrl))
      .toBe('base/bulk-123/0.mp3');
  });

  it.each([
    'https://external.example/storage/v1/object/public/roleplay-audio/base/bulk-123/0.mp3',
    `${supabaseUrl}/storage/v1/object/public/roleplay-audio/responses/x.mp3`,
    `${publicBase}/bulk-123/0.mp3?download=1`,
    `${publicBase}/bulk-123/%2e%2e/file.mp3`,
    `${publicBase}/bulk-123/file%2Fother.mp3`,
    `${supabaseUrl}/storage/v1/object/sign/roleplay-audio/base/bulk-123/0.mp3?token=x`,
    'not a url',
  ])('rejects unsafe or non-reusable URL %s', (audioUrl) => {
    expect(getReusableBaseAudioPath(audioUrl, supabaseUrl)).toBeNull();
  });
});

describe('getRoleplaySnapshotHash', () => {
  const scenarios = [
    { order: 0, title: 'Medical introduction', baseAudioUrl: `${publicBase}/a/0.mp3`, durationLimitSec: 300, scriptPrompt: null },
    { order: 1, title: 'Patient follow-up', baseAudioUrl: `${publicBase}/a/1.mp3`, durationLimitSec: 240, scriptPrompt: 'Interpret faithfully' },
  ];
  it('is stable when input rows are provided in a different order', () => {
    expect(getRoleplaySnapshotHash(scenarios)).toBe(getRoleplaySnapshotHash([...scenarios].reverse()));
  });
  it('changes when a referenced audio or prompt changes', () => {
    expect(getRoleplaySnapshotHash(scenarios)).not.toBe(getRoleplaySnapshotHash([
      { ...scenarios[0], baseAudioUrl: `${publicBase}/b/0.mp3` }, scenarios[1],
    ]));
  });
});
