import { describe, expect, it } from 'vitest';
import { getReusableBaseAudioPath } from './roleplay-library';

const origin = 'https://project.supabase.co';
const url = (path: string) =>
  `${origin}/storage/v1/object/public/roleplay-audio/${path}`;

describe('getReusableBaseAudioPath', () => {
  it('recognizes legacy flat base paths created by getBaseAudioPath', () => {
    expect(getReusableBaseAudioPath(url('base/cksession123.mp3'), origin))
      .toBe('base/cksession123.mp3');
    expect(getReusableBaseAudioPath(url('base/cksession123.webm'), origin))
      .toBe('base/cksession123.webm');
  });

  it('continues recognizing modern nested Studio upload paths', () => {
    expect(getReusableBaseAudioPath(url('base/session-x/upload-123/0.wav'), origin))
      .toBe('base/session-x/upload-123/0.wav');
  });

  it('rejects encoded traversal, relative segments, empty keys and double slashes', () => {
    for (const key of [
      'base/%2e%2e/private.mp3',
      'base/../private.mp3',
      'base/./private.mp3',
      'base/..' + String.fromCharCode(92) + 'private.mp3',
      'base/.' + String.fromCharCode(92) + 'private.mp3',
      'base/',

      'base//private.mp3',
    ]) {
      expect(getReusableBaseAudioPath(url(key), origin)).toBeNull();
    }
  });

  it('rejects other Storage buckets, response objects and external projects', () => {
    expect(getReusableBaseAudioPath(
      `${origin}/storage/v1/object/public/another-bucket/base/session.mp3`, origin,
    )).toBeNull();
    expect(getReusableBaseAudioPath(url('responses/session/recording.mp3'), origin)).toBeNull();
    expect(getReusableBaseAudioPath(
      'https://external.supabase.co/storage/v1/object/public/roleplay-audio/base/cksession123.mp3',
      origin,
    )).toBeNull();
  });

  it('never accepts pre-signed links, query strings, fragments or object keys with escaping', () => {
    for (const value of [
      `${url('base/cksession123.mp3')}?token=PRIVATE_TOKEN`,
      `${url('base/cksession123.mp3')}#fragment`,
      `${url('base/session%2Fother.mp3')}`,
      `${url('base/cksession123.mp3')}?download=1`,
    ]) {
      expect(getReusableBaseAudioPath(value, origin)).toBeNull();
    }
  });
});
