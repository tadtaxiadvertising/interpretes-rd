import { describe, expect, it, vi } from 'vitest';
import { prepareOpeningStorage } from './roleplay-opening-storage-preflight';

const name = 'roleplay-opening-private';
const bucket = { id: name, name, public: false, file_size_limit: 15 * 1024 * 1024,
  allowed_mime_types: ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg'] };
function fixture(buckets: unknown[] = []) {
  return {
    listBuckets: vi.fn().mockResolvedValue({ data: buckets, error: null }),
    getBucket: vi.fn().mockResolvedValue({ data: bucket, error: null }),
    createBucket: vi.fn().mockResolvedValue({ data: { name }, error: null }),
  };
}

describe('private opening storage preparation', () => {
  it('checks by default without creating anything', async () => {
    const storage = fixture([{ id: 'roleplay-audio' }]);
    expect(await prepareOpeningStorage(storage)).toBe('missing');
    expect(storage.createBucket).not.toHaveBeenCalled();
  });
  it('creates only the dedicated private bucket and verifies it', async () => {
    const storage = fixture([{ id: 'roleplay-audio' }]);
    expect(await prepareOpeningStorage(storage, true)).toBe('created');
    expect(storage.createBucket).toHaveBeenCalledWith(name, {
      public: false, fileSizeLimit: 15 * 1024 * 1024,
      allowedMimeTypes: ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg'],
    });
    expect(storage.getBucket).toHaveBeenCalledWith(name);
  });
  it('never mutates an existing bucket, even when misconfigured', async () => {
    const storage = fixture([bucket]);
    expect(await prepareOpeningStorage(storage, true)).toBe('ready');
    storage.getBucket.mockResolvedValueOnce({ data: { ...bucket, public: true }, error: null });
    expect(await prepareOpeningStorage(storage, true)).toBe('misconfigured');
    expect(storage.createBucket).not.toHaveBeenCalled();
  });
  it('refuses to create after a failed or malformed listing', async () => {
    const storage = fixture();
    storage.listBuckets.mockResolvedValueOnce({ data: [], error: new Error('private details') });
    expect(await prepareOpeningStorage(storage, true)).toBe('unavailable');
    storage.listBuckets.mockResolvedValueOnce({ data: [{}], error: null });
    expect(await prepareOpeningStorage(storage, true)).toBe('unavailable');
    expect(storage.createBucket).not.toHaveBeenCalled();
  });
  it('handles a concurrent creator only after verifying the resulting bucket', async () => {
    const storage = fixture();
    storage.createBucket.mockResolvedValue({ data: null, error: { message: 'conflict' } });
    expect(await prepareOpeningStorage(storage, true)).toBe('ready');
    storage.getBucket.mockResolvedValueOnce({ data: { ...bucket, public: true }, error: null });
    expect(await prepareOpeningStorage(storage, true)).toBe('unavailable');
  });
});
