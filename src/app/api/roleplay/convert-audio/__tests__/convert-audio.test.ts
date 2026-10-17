// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

const { mockDownload, mockUpload, mockUpdateMany } = vi.hoisted(() => ({
  mockDownload: vi.fn(),
  mockUpload: vi.fn(),
  mockUpdateMany: vi.fn(),
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

vi.mock('@/lib/prisma', () => ({
  default: { roleplayResponse: { updateMany: mockUpdateMany } },
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
  mockUpdateMany.mockResolvedValue({ count: 1 });
});

describe('convertAndStoreMp3', () => {
  it('persists processedAudioPath on the response identified by scenarioId, not by order', async () => {
    await convertAndStoreMp3(SESSION_ID, SCENARIO_ID, `responses/${SESSION_ID}/${SCENARIO_ID}.webm`);

    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    const arg = mockUpdateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ scenarioId: SCENARIO_ID });
    // The old bug derived `order` from a cuid (always 0); ensure no such filter.
    expect(arg.where).not.toHaveProperty('order');
    expect(arg.where).not.toHaveProperty('scenario');
    expect(arg.data).toEqual({
      processedAudioPath: `responses/${SESSION_ID}/${SCENARIO_ID}.mp3`,
      audioStatus: 'READY',
    });
  });

  it('marks the correct response FAILED when conversion fails', async () => {
    mockDownload.mockResolvedValue({ data: null, error: { message: 'not found' } });

    await expect(
      convertAndStoreMp3(SESSION_ID, SCENARIO_ID, 'responses/x/y.webm')
    ).rejects.toThrow();

    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    const arg = mockUpdateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ scenarioId: SCENARIO_ID });
    expect(arg.data.audioStatus).toBe('FAILED');
    expect(typeof arg.data.processingError).toBe('string');
  });
});
