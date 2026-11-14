import { describe, expect, it } from 'vitest';
import { getAdminRoleplayAudioExtension } from './admin-audio-extension';

describe('canonical admin Roleplay audio suffix', () => {
  it.each([
    ['audio/webm', 'webm'],
    ['audio/mp4', 'mp4'],
    ['audio/wav', 'wav'],
    ['audio/mpeg', 'mp3'],
  ] as const)('returns %s as the canonical extension %s', (mime, expected) => {
    expect(getAdminRoleplayAudioExtension(mime)).toBe(expected);
  });

  it.each([
    'text/html',
    'image/svg+xml',
    'application/javascript',
    'audio/webm-malicious',
    'audio/mpeg;name=attack.html',
    'audio/mp4;evil=1',
    '__proto__',
    'constructor',
    '',
  ])('rejects arbitrary or spoofed MIME %s', (mime) => {
    expect(getAdminRoleplayAudioExtension(mime)).toBeNull();
  });
});
