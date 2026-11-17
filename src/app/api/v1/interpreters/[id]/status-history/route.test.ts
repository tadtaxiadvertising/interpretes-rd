// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  guard: vi.fn(),
  findInterpreter: vi.fn(),
  findLogs: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ guardApiAuth: m.guard }));
vi.mock('@/lib/prisma', () => ({
  default: {
    interpreter: { findUnique: m.findInterpreter },
    interpreterStatusLog: { findMany: m.findLogs },
  },
}));

import { GET } from './route';

const params = (id = '7') => ({ params: Promise.resolve({ id }) });
const request = (suffix = '') =>
  new Request('https://interpretes.example/api/v1/interpreters/7/status-history' + suffix);

function expectPrivate(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  for (const value of ['Cookie', 'Authorization', 'Origin']) {
    expect(response.headers.get('Vary')).toContain(value);
  }
}

describe('GET interpreter status history admin boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.guard.mockResolvedValue(null);
    m.findInterpreter.mockResolvedValue({ id: 7, name: 'Synthetic Interpreter', realtimeStatus: 'Online' });
    m.findLogs.mockResolvedValue([{
      id: 1, previousStatus: 'Offline', newStatus: 'Online',
      reason: 'login', changedBy: 'system',
      metadata: null, createdAt: new Date('2026-11-17T12:00:00Z'),
    }]);
  });

  it('denies an unauthorized request before querying interpreter status', async () => {
    m.guard.mockResolvedValueOnce(Response.json({ error: 'Forbidden' }, { status: 403 }));
    const result = await GET(request(), params());
    expect(result.status).toBe(403);
    expectPrivate(result);
    expect(m.guard).toHaveBeenCalledWith(expect.any(Request), 'admin');
    expect(m.findInterpreter).not.toHaveBeenCalled();
    expect(m.findLogs).not.toHaveBeenCalled();
  });

  it('returns the same status-log contract with private headers and a bounded default', async () => {
    const result = await GET(request(), params());
    expect(result.status).toBe(200);
    expectPrivate(result);
    const body = await result.json();
    expect(body).toMatchObject({
      success: true,
      interpreter: { id: 7, name: 'Synthetic Interpreter', currentStatus: 'Online' },
      logs: [{ id: 1, previousStatus: 'Offline', newStatus: 'Online', reason: 'login' }],
    });
    expect(m.findInterpreter).toHaveBeenCalledWith({
      where: { id: 7 }, select: { id: true, name: true, realtimeStatus: true },
    });
    expect(m.findLogs).toHaveBeenCalledWith({
      where: { interpreterId: 7 },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true, previousStatus: true, newStatus: true, reason: true,
        changedBy: true, metadata: true, createdAt: true,
      },
    });
  });

  it('accepts a maximum 100-row request without changing response shape', async () => {
    const response = await GET(request('?limit=100'), params());
    expect(response.status).toBe(200);
    expectPrivate(response);
    expect(m.findLogs).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 }),
    );
  });

  it.each([
    '0', '101', '-3', 'NaN', '1.5', '', '5foo', '0005', 'Infinity', '9999999999',
  ])('rejects malformed history limit %j before reading Prisma', async (limit) => {
    const response = await GET(request('?limit=' + encodeURIComponent(limit)), params());
    expect(response.status).toBe(400);
    expectPrivate(response);
    expect(m.findInterpreter).not.toHaveBeenCalled();
    expect(m.findLogs).not.toHaveBeenCalled();
  });

  it.each(['12foo', '0', '-7', 'not-an-id', '1.5'])(
    'rejects malformed interpreter ID %j before Prisma', async (id) => {
      const response = await GET(request(), params(id));
      expect(response.status).toBe(400);
      expectPrivate(response);
      expect(m.findInterpreter).not.toHaveBeenCalled();
      expect(m.findLogs).not.toHaveBeenCalled();
    },
  );

  it('returns a private 404 without querying logs when interpreter is absent', async () => {
    m.findInterpreter.mockResolvedValueOnce(null);
    const response = await GET(request(), params());
    expect(response.status).toBe(404);
    expectPrivate(response);
    expect(m.findLogs).not.toHaveBeenCalled();
  });

  it('logs only an error category, not database credentials or stack details', async () => {
    m.findLogs.mockRejectedValueOnce(
      new Error('postgresql://admin:PRIVATE_PASSWORD@internal.test/status'),
    );
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await GET(request(), params());
      expect(response.status).toBe(500);
      expectPrivate(response);
      expect(await response.json()).toEqual({ success: false, error: 'Internal Server Error' });
      expect(log).toHaveBeenCalledWith('[StatusHistory] Error:', 'Error');
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE_PASSWORD|internal\.test|postgresql:/);
    } finally { log.mockRestore(); }
  });
});
