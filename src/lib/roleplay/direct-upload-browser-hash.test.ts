// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import {
  hashRoleplayFilesSequentially,
  RoleplayBrowserHashError,
} from './direct-upload-browser-hash';

function fixture(text: string, mime = 'audio/mpeg') {
  const bytes = new TextEncoder().encode(text);
  const file = new File([bytes], 'PRIVATE_PATIENT_NAME.mp3', { type: mime });
  // jsdom File does not implement arrayBuffer in all supported versions.
  const read = vi.fn(async () => bytes.buffer);
  Object.defineProperty(file, 'arrayBuffer', { configurable: true, value: read });
  return { file, read };
}

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());

describe('future browser-side Roleplay direct-upload hash declarations (unwired)', () => {
  it('computes a real lowercase SHA-256 for one MP3 without uploading it', async () => {
    const { file, read } = fixture('abc');
    const result = await hashRoleplayFilesSequentially([file]);
    expect(result).toEqual([{
      order: 0,
      mime: 'audio/mpeg',
      sizeBytes: 3,
      sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    }]);
    expect(read).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain('PRIVATE_PATIENT_NAME');
  });

  it('reads and hashes all 25 files in order, never buffering the whole batch', async () => {
    const events: string[] = [];
    const files = Array.from({ length: 25 }, (_, index) => {
      const { file, read } = fixture('ID3' + index);
      read.mockImplementation(async () => {
        events.push('read:' + index);
        return new TextEncoder().encode('ID3' + index).buffer;
      });
      return file;
    });
    const progress = vi.fn((completed: number, total: number) => {
      events.push('done:' + (completed - 1));
      expect(total).toBe(25);
    });

    const declarations = await hashRoleplayFilesSequentially(files, { onHashed: progress });
    expect(declarations).toHaveLength(25);
    expect(declarations.map(x => x.order)).toEqual(Array.from({ length: 25 }, (_, i) => i));
    expect(progress).toHaveBeenCalledTimes(25);
    for (let i = 0; i < 25; i++) {
      expect(events.slice(i * 2, i * 2 + 2)).toEqual(['read:' + i, 'done:' + i]);
    }
  });

  it('uses the original file snapshot even if progress changes the draft', async () => {
    const first = fixture('abc');
    const second = fixture('def');
    const injected = fixture('private-new-draft');
    const files = [first.file, second.file];
    const result = await hashRoleplayFilesSequentially(files, {
      onHashed: completed => {
        if (completed === 1) {
          files[1] = injected.file;
          files.push(injected.file);
        }
      },
    });
    expect(result).toHaveLength(2);
    expect(result.map(item => item.sizeBytes)).toEqual([3, 3]);
    expect(second.read).toHaveBeenCalledOnce();
    expect(injected.read).not.toHaveBeenCalled();
  });

  it('rejects invalid file batches before reading any private bytes', async () => {
    const valid = fixture('abc');
    const empty = fixture('');
    const unsupported = fixture('abc', 'text/plain');
    for (const input of [
      [],
      Array.from({ length: 26 }, () => valid.file),
      [valid.file, empty.file],
      [unsupported.file],
      [valid.file, { size: 3, type: 'audio/mpeg' } as File],
    ]) {
      await expect(hashRoleplayFilesSequentially(input)).rejects.toMatchObject({
        code: 'INVALID_FILES', hashedCount: 0,
      });
    }
    expect(valid.read).not.toHaveBeenCalled();
    expect(empty.read).not.toHaveBeenCalled();
    expect(unsupported.read).not.toHaveBeenCalled();
  });

  it('cancels before hashing and after the first progress event', async () => {
    const first = fixture('abc');
    const second = fixture('def');
    const controller = new AbortController();
    controller.abort();
    await expect(hashRoleplayFilesSequentially([first.file], {
      signal: controller.signal,
    })).rejects.toMatchObject({ code: 'CANCELLED', hashedCount: 0 });
    expect(first.read).not.toHaveBeenCalled();

    const afterFirst = new AbortController();
    await expect(hashRoleplayFilesSequentially([first.file, second.file], {
      signal: afterFirst.signal,
      onHashed: () => afterFirst.abort(),
    })).rejects.toMatchObject({ code: 'CANCELLED', hashedCount: 1 });
    expect(first.read).toHaveBeenCalledOnce();
    expect(second.read).not.toHaveBeenCalled();
  });

  it('does not claim success if cancellation follows the last hash', async () => {
    const { file } = fixture('abc');
    const controller = new AbortController();
    await expect(hashRoleplayFilesSequentially([file], {
      signal: controller.signal,
      onHashed: () => controller.abort(),
    })).rejects.toMatchObject({ code: 'CANCELLED', hashedCount: 1 });
  });

  it('stops before digesting if cancellation occurs during file read', async () => {
    const first = fixture('abc');
    const second = fixture('def');
    const controller = new AbortController();
    first.read.mockImplementation(async () => {
      controller.abort();
      return new TextEncoder().encode('abc').buffer;
    });
    await expect(hashRoleplayFilesSequentially([first.file, second.file], {
      signal: controller.signal,
    })).rejects.toMatchObject({ code: 'CANCELLED', hashedCount: 0 });
    expect(second.read).not.toHaveBeenCalled();
  });

  it('handles unavailable cryptography and sanitizes failures', async () => {
    const { file, read } = fixture('abc');
    vi.stubGlobal('crypto', {});
    await expect(hashRoleplayFilesSequentially([file])).rejects.toMatchObject({
      code: 'CRYPTO_UNAVAILABLE', hashedCount: 0,
    });
    expect(read).not.toHaveBeenCalled();

    vi.stubGlobal('crypto', webcrypto);
    read.mockRejectedValueOnce(new Error('PATIENT_NAME_OR_PRIVATE_OBJECT_PATH'));
    let error: unknown;
    try {
      await hashRoleplayFilesSequentially([file]);
    } catch (cause) { error = cause; }
    expect(error).toBeInstanceOf(RoleplayBrowserHashError);
    expect(error).toMatchObject({ code: 'HASH_FAILED', hashedCount: 0 });
    expect(String(error)).not.toContain('PATIENT_NAME_OR_PRIVATE_OBJECT_PATH');
  });

  it('does not hash another file after a progress callback throws', async () => {
    const first = fixture('abc');
    const second = fixture('def');
    await expect(hashRoleplayFilesSequentially([first.file, second.file], {
      onHashed: () => { throw new Error('PRIVATE_CALLBACK_DETAILS'); },
    })).rejects.toMatchObject({ code: 'PROGRESS_FAILED', hashedCount: 1 });
    expect(second.read).not.toHaveBeenCalled();
  });
});
