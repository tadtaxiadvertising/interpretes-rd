// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { sha256RoleplayFile } from './roleplay-streaming-checksum';

describe('roleplay multipart audio streaming checksum', () => {
  it('matches SHA-256 without invoking File.arrayBuffer', async () => {
    const bytes = new Uint8Array(384 * 1024);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
    const file = new File([bytes], 'roleplay.webm', { type: 'audio/webm' });
    const forbidden = vi.spyOn(file, 'arrayBuffer').mockImplementation(async () => {
      throw new Error('Full-file buffering is forbidden for checksum calculation');
    });

    const digest = await sha256RoleplayFile(file);
    expect(digest).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(forbidden).not.toHaveBeenCalled();
    forbidden.mockRestore();
  });

  it('handles an empty stream and small files consistently', async () => {
    expect(await sha256RoleplayFile(new File([], 'empty.webm')))
      .toBe(createHash('sha256').update('').digest('hex'));
    expect(await sha256RoleplayFile(new File(['roleplay'], 'one.webm')))
      .toBe(createHash('sha256').update('roleplay').digest('hex'));
  });

  it('propagates stream errors rather than accepting an incomplete checksum', async () => {
    const file = {
      stream: () => new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.error(new Error('Synthetic interrupted upload'));
        },
      }),
    } as Pick<File, 'stream'>;
    await expect(sha256RoleplayFile(file)).rejects.toThrow('Synthetic interrupted upload');
  });
});
