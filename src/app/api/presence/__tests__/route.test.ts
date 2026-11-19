// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  actorFromBearer: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  statusCreate: vi.fn(),
  transaction: vi.fn(),
  parseJsonBody: vi.fn(),
}));

vi.mock('@/lib/auth/actions', () => ({ getCurrentUser: m.getCurrentUser }));
vi.mock('@/lib/api-auth', () => ({ actorFromBearer: m.actorFromBearer }));
vi.mock('@/lib/prisma', () => ({
  default: {
    interpreter: { findUnique: m.findUnique, update: m.update },
    interpreterStatusLog: { create: m.statusCreate },
    $transaction: m.transaction,
  },
}));
vi.mock('@/lib/api-responses', () => ({
  parseJsonBody: m.parseJsonBody,
  apiError: () => Response.json({ error: 'Internal Server Error' }, { status: 500 }),
}));

import { GET, POST } from '../route';

const cookieUser = {
  id: 'cookie-user',
  profile: { role: 'interpreter', interpreterId: 42 },
};
const matchingBearer = {
  userId: 'cookie-user', role: 'interpreter', interpreterId: 42,
};

function request(method: 'GET' | 'POST', authorization?: string): Request {
  return new Request('https://interpretes.example/api/presence', {
    method,
    headers: {
      ...(authorization === undefined ? {} : { Authorization: authorization }),
      ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(method === 'POST' ? { body: JSON.stringify({ type: 'heartbeat' }) } : {}),
  });
}

function expectPrivate(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  for (const dimension of ['Cookie', 'Authorization', 'Origin']) {
    expect(response.headers.get('Vary')).toContain(dimension);
  }
}

describe('Presence cookie/Bearer identity safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.getCurrentUser.mockResolvedValue(cookieUser);
    m.actorFromBearer.mockResolvedValue(matchingBearer);
    m.findUnique.mockResolvedValue({
      realtimeStatus: 'Online',
      lastHeartbeat: new Date('2026-11-18T12:00:00.000Z'),
      statusChangedAt: new Date('2026-11-18T12:00:00.000Z'),
      statusReason: 'login',
    });
    m.update.mockResolvedValue({ id: 42 });
    m.parseJsonBody.mockResolvedValue({ type: 'heartbeat' });
  });

  it('keeps browser cookie-only presence reads working', async () => {
    const res = await GET(request('GET'));
    expect(res.status).toBe(200);
    expectPrivate(res);
    expect(m.actorFromBearer).not.toHaveBeenCalled();
    expect(m.findUnique).toHaveBeenCalledWith({
      where: { id: 42 },
      select: {
        realtimeStatus: true, lastHeartbeat: true,
        statusChangedAt: true, statusReason: true,
      },
    });
  });

  it('allows a verified matching Bearer and cookie to read presence', async () => {
    const res = await GET(request('GET', 'Bearer matching-token'));
    expect(res.status).toBe(200);
    expect(m.actorFromBearer).toHaveBeenCalledOnce();
    expect(m.findUnique).toHaveBeenCalledOnce();
  });

  it('blocks a different user before accessing presence data', async () => {
    m.actorFromBearer.mockResolvedValueOnce({
      userId: 'another-user', role: 'interpreter', interpreterId: 42,
    });
    const res = await GET(request('GET', 'Bearer other-user'));
    expect(res.status).toBe(403);
    expect(m.findUnique).not.toHaveBeenCalled();
    expectPrivate(res);
  });

  it('blocks a different interpreter assignment even for the same user', async () => {
    m.actorFromBearer.mockResolvedValueOnce({
      userId: 'cookie-user', role: 'interpreter', interpreterId: 99,
    });
    const res = await GET(request('GET', 'Bearer mismatched-assignment'));
    expect(res.status).toBe(403);
    expect(m.findUnique).not.toHaveBeenCalled();
  });

  it('rejects invalid and malformed Authorization rather than falling back to cookie', async () => {
    for (const value of ['Basic invalid', 'Bearer expired']) {
      m.actorFromBearer.mockResolvedValueOnce(null);
      const res = await GET(request('GET', value));
      expect(res.status).toBe(403);
    }
    expect(m.findUnique).not.toHaveBeenCalled();
  });

  it('rejects mixed identities before parsing or writing a heartbeat', async () => {
    m.actorFromBearer.mockResolvedValueOnce({
      userId: 'other-user', role: 'interpreter', interpreterId: 77,
    });
    const res = await POST(request('POST', 'Bearer other-user'));
    expect(res.status).toBe(403);
    expect(m.parseJsonBody).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it('rejects role confusion before writing presence', async () => {
    m.actorFromBearer.mockResolvedValueOnce({
      userId: 'cookie-user', role: 'admin', interpreterId: 42,
    });
    const res = await POST(request('POST', 'Bearer wrong-role'));
    expect(res.status).toBe(403);
    expect(m.update).not.toHaveBeenCalled();
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it('keeps an authorized matching interpreter heartbeat working', async () => {
    const res = await POST(request('POST', 'Bearer matching-token'));
    expect(res.status).toBe(200);
    expect(m.update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { lastHeartbeat: expect.any(Date) },
      select: { id: true },
    });
  });

  it('fails closed when independent Bearer verification throws', async () => {
    m.actorFromBearer.mockImplementationOnce(() => {
      throw new Error('Synthetic identity verification failure');
    });
    const res = await POST(request('POST', 'Bearer unavailable'));
    expect(res.status).toBe(403);
    expect(m.update).not.toHaveBeenCalled();
  });

  it('does not permit caching an authenticated heartbeat response', async () => {
    const res = await POST(request('POST'));
    expect(res.status).toBe(200);
    expectPrivate(res);
    expect((await res.json()).heartbeat).toBe(true);
  });

  it('protects the anonymous-like offline fallback from intermediary caches', async () => {
    m.getCurrentUser.mockResolvedValueOnce(null);
    const res = await GET(request('GET'));
    expect(res.status).toBe(200);
    expectPrivate(res);
    expect(await res.json()).toEqual({ online: false });
    expect(m.findUnique).not.toHaveBeenCalled();
  });

  it('protects failed presence reads from intermediary caches', async () => {
    m.findUnique.mockRejectedValueOnce(new Error('Synthetic database error'));
    const res = await GET(request('GET'));
    expect(res.status).toBe(500);
    expectPrivate(res);
    expect(await res.json()).toEqual({ online: false });
  });

  it('protects schema/handler errors without exposing their details', async () => {
    m.parseJsonBody.mockRejectedValueOnce(new Error('PRIVATE_PRESENCE_TOKEN'));
    const res = await POST(request('POST'));
    expect(res.status).toBe(500);
    expectPrivate(res);
    expect(JSON.stringify(await res.json())).not.toContain('PRIVATE_PRESENCE_TOKEN');
    expect(m.update).not.toHaveBeenCalled();
  });

  it('does not accept Bearer-only writes without a cookie identity', async () => {
    m.getCurrentUser.mockResolvedValueOnce(null);
    const res = await POST(request('POST', 'Bearer valid-but-no-cookie'));
    expect(res.status).toBe(401);
    expect(m.actorFromBearer).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });
});
