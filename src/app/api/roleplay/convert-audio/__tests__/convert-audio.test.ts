// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

const { mockDownload, mockUpload } = vi.hoisted(() => ({
  mockDownload: vi.fn(),
  mockUpload: vi.fn(),
}));

vi.mock('ffmpeg-static', () => ({ default: '/fake/ffmpeg' }));

vi.mock('child_process', () => ({
  spawn: vi.fn(() => {
    const proc: any = new EventEmitter();
    proc.stderr = new EventEmitter();
    queueMicrotask(() => proc.emit('close', 0));
    return proc;
  }),
}));

vi.mock('fs/promises', () => ({
  writeFile: vi.fn(async () => {}),
  readFile: vi.fn(async () => Buffer.from('mp3-bytes')),
  unlink: vi.fn(async () => {}),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({ download: mockDownload, upload: mockUpload })),
    },
  })),
}));

vi.mock('@/lib/identity/resolve-user', () => ({ resolveCurrentIdentity: vi.fn() }));

import { convertAndStoreMp3 } from '@/lib/roleplay-audio-conversion';

const SESSION_ID = 'clsession123';
const SCENARIO_ID = 'clscenariocuid999';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
  mockDownload.mockResolvedValue({
    data: { arrayBuffer: async () => new ArrayBuffer(8) },
    error: null,
  });
  mockUpload.mockResolvedValue({ error: null });
});

describe('convertAndStoreMp3', () => {
  it('returns the deterministic MP3 path without publishing response state', async () => {
    const sourcePath = `responses/${SESSION_ID}/${SCENARIO_ID}/00000000-0000-4000-8000-000000000001.webm`;
    const processedPath = await convertAndStoreMp3(SESSION_ID, SCENARIO_ID, sourcePath);

    expect(processedPath).toBe(sourcePath.replace(/\.webm$/i, '.mp3'));
    expect(mockUpload).toHaveBeenCalledWith(
      processedPath,
      Buffer.from('mp3-bytes'),
      { contentType: 'audio/mpeg', upsert: true },
    );
    // The worker, not this storage helper, atomically publishes READY with
    // completion of the queue job after verifying its lease.
  });

  it('does not publish response state when the source download fails', async () => {
    mockDownload.mockResolvedValue({ data: null, error: { message: 'not found' } });

    await expect(
      convertAndStoreMp3(SESSION_ID, SCENARIO_ID, 'responses/x/y.webm')
    ).rejects.toThrow();

    expect(mockUpload).not.toHaveBeenCalled();
  });
});
