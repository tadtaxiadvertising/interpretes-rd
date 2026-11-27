// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { collectRoleplayCreationAudioDigests } from './creation-audio-digests';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const audio = (value: string, name = 'synthetic.mp3') => new File([value], name, { type: 'audio/mpeg' });

describe('server-derived Roleplay creation audio digests', () => {
  it('hashes all actual audio bytes in order without materializing an arrayBuffer', async () => {
    const files = [audio('first'), audio('second')];
    const buffers = files.map(file => vi.spyOn(file, 'arrayBuffer'));
    expect(await collectRoleplayCreationAudioDigests(files, [null, hash('second').toUpperCase()])).toEqual([
      { mime: 'audio/mpeg', sizeBytes: 5, sha256: hash('first') },
      { mime: 'audio/mpeg', sizeBytes: 6, sha256: hash('second') },
    ]);
    for (const buffer of buffers) expect(buffer).not.toHaveBeenCalled();
  });
  it('ignores filenames and detects changed bytes when no client checksum is supplied', async () => {
    const first = await collectRoleplayCreationAudioDigests([audio('a', 'one.mp3')]);
    expect(await collectRoleplayCreationAudioDigests([audio('a', 'two.mp3')])).toEqual(first);
    expect(await collectRoleplayCreationAudioDigests([audio('b', 'one.mp3')])).not.toEqual(first);
  });
  it('rejects mismatching client checksums before opening a later audio stream', async () => {
    const later = audio('later');
    const stream = vi.spyOn(later, 'stream');
    await expect(collectRoleplayCreationAudioDigests([audio('actual'), later], [hash('wrong'), null]))
      .rejects.toMatchObject({ reason: 'CHECKSUM_MISMATCH', scenario: 1 });
    expect(stream).not.toHaveBeenCalled();
  });
  it('validates the entire batch before hashing any audio', async () => {
    const first = audio('valid');
    const stream = vi.spyOn(first, 'stream');
    for (const invalid of ['', audio(''), new File(['x'], 'synthetic.txt', { type: 'text/plain' })]) {
      await expect(collectRoleplayCreationAudioDigests([first, invalid]))
        .rejects.toMatchObject({ reason: 'INVALID_AUDIO', scenario: 2 });
    }
    await expect(collectRoleplayCreationAudioDigests([])).rejects.toMatchObject({ reason: 'INVALID_AUDIO' });
    await expect(collectRoleplayCreationAudioDigests(Array(26).fill(first))).rejects.toMatchObject({ reason: 'INVALID_AUDIO' });
    expect(stream).not.toHaveBeenCalled();
  });
  it('rejects malformed and missing checksum entries before opening streams', async () => {
    const file = audio('valid');
    const stream = vi.spyOn(file, 'stream');
    for (const invalid of [[], ['not-a-checksum'], [hash('valid'), null], Array<string | null>(1)]) {
      await expect(collectRoleplayCreationAudioDigests([file], invalid))
        .rejects.toMatchObject({ reason: 'INVALID_CHECKSUMS' });
    }
    expect(stream).not.toHaveBeenCalled();
  });
  it('rejects files above the existing per-file budget without reading them', async () => {
    const file = audio('valid');
    Object.defineProperty(file, 'size', { value: 15 * 1024 * 1024 + 1 });
    const stream = vi.spyOn(file, 'stream');
    await expect(collectRoleplayCreationAudioDigests([file])).rejects.toMatchObject({ reason: 'INVALID_AUDIO', scenario: 1 });
    expect(stream).not.toHaveBeenCalled();
  });
});
