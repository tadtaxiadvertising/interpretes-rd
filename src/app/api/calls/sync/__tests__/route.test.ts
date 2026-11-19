// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/api-auth', () => ({ actorFromBearer: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  default: {
    userProfile: { findUnique: vi.fn() },
    callSession: {
      findMany: vi.fn(), count: vi.fn(), update: vi.fn(),
    },
    productionLog: {
      findFirst: vi.fn(), update: vi.fn(), create: vi.fn(),
    },
    callProductionEntry: { create: vi.fn() },
  },
}));

import { auth } from '@/lib/auth';
import { actorFromBearer } from '@/lib/api-auth';
import prisma from '@/lib/prisma';
import { GET, POST } from '../route';

const request = (method: 'GET' | 'POST', authorization?: string) =>
  new NextRequest('https://interpretes.example/api/calls/sync', {
    method,
    headers: authorization === undefined ? {} : { Authorization: authorization },
  });

function expectPrivate(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  for (const value of ['Cookie', 'Authorization', 'Origin']) {
    expect(response.headers.get('Vary')).toContain(value);
  }
}

function noMutations() {
  expect(prisma.callSession.findMany).not.toHaveBeenCalled();
  expect(prisma.callSession.update).not.toHaveBeenCalled();
  expect(prisma.productionLog.findFirst).not.toHaveBeenCalled();
  expect(prisma.productionLog.update).not.toHaveBeenCalled();
  expect(prisma.productionLog.create).not.toHaveBeenCalled();
  expect(prisma.callProductionEntry.create).not.toHaveBeenCalled();
}

describe('legacy call sync is non-mutating until ledger reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({
      userId: 'interpreter-profile-7', user: { id: 'interpreter-profile-7' },
    } as never);
    vi.mocked(actorFromBearer).mockResolvedValue({
      userId: 'interpreter-profile-7',
      role: 'interpreter',
      interpreterId: 7,
    } as never);
  });

  it('denies unauthenticated POST without any database access', async () => {
    vi.mocked(auth).mockResolvedValueOnce({ userId: null, user: null } as never);
    const response = await POST(request('POST'));
    expect(response.status).toBe(401);
    expectPrivate(response);
    expect(prisma.userProfile.findUnique).not.toHaveBeenCalled();
    noMutations();
  });

  it('returns an explicit 409 and does not replay or settle any call sessions', async () => {
    const response = await POST(request('POST'));
    expect(response.status).toBe(409);
    expectPrivate(response);
    expect(await response.json()).toMatchObject({
      success: false, code: 'LEGACY_CALL_SYNC_PAUSED',
    });
    expect(prisma.userProfile.findUnique).not.toHaveBeenCalled();
    noMutations();
  });

  it('keeps the legacy diagnostic GET read-only and warns counts are unverified', async () => {
    vi.mocked(prisma.userProfile.findUnique).mockResolvedValueOnce({
      interpreterId: 7,
    } as never);
    vi.mocked(prisma.callSession.count).mockResolvedValueOnce(3 as never);
    const response = await GET(request('GET'));
    expect(response.status).toBe(200);
    expectPrivate(response);
    expect(await response.json()).toEqual({
      success: true,
      orphanedSessions: 3,
      reconciliationVerified: false,
      synchronizationDisabled: true,
    });
    expect(prisma.callSession.count).toHaveBeenCalledWith({
      where: {
        interpreterId: 7,
        endedAt: { not: null },
        durationSeconds: { gt: 0 },
        isSettled: false,
      },
    });
    noMutations();
  });

  it('denies anonymous GET before inspecting a user profile', async () => {
    vi.mocked(auth).mockResolvedValueOnce({ userId: null, user: null } as never);
    const response = await GET(request('GET'));
    expect(response.status).toBe(401);
    expectPrivate(response);
    expect(prisma.userProfile.findUnique).not.toHaveBeenCalled();
    expect(prisma.callSession.count).not.toHaveBeenCalled();
    noMutations();
  });

  it('retains the legacy diagnostic for a valid matching explicit Bearer', async () => {
    vi.mocked(prisma.userProfile.findUnique).mockResolvedValueOnce({
      interpreterId: 7,
    } as never);
    vi.mocked(prisma.callSession.count).mockResolvedValueOnce(2 as never);
    const response = await GET(request('GET', 'Bearer matched'));
    expect(response.status).toBe(200);
    expect((await response.json()).orphanedSessions).toBe(2);
    expect(actorFromBearer).toHaveBeenCalledOnce();
    expect(prisma.callSession.count).toHaveBeenCalledOnce();
  });

  it('denies an invalid or malformed Bearer before reading a user profile', async () => {
    for (const header of ['Basic invalid', 'Bearer expired']) {
      vi.mocked(actorFromBearer).mockResolvedValueOnce(null);
      const response = await GET(request('GET', header));
      expect(response.status).toBe(403);
      expectPrivate(response);
    }
    expect(prisma.userProfile.findUnique).not.toHaveBeenCalled();
    expect(prisma.callSession.count).not.toHaveBeenCalled();
    noMutations();
  });

  it('denies a different Bearer user even when the cookie is authenticated', async () => {
    vi.mocked(actorFromBearer).mockResolvedValueOnce({
      userId: 'another-user', role: 'interpreter', interpreterId: 7,
    } as never);
    const response = await GET(request('GET', 'Bearer other-user'));
    expect(response.status).toBe(403);
    expect(prisma.userProfile.findUnique).not.toHaveBeenCalled();
    expect(prisma.callSession.count).not.toHaveBeenCalled();
    noMutations();
  });

  it('denies admin/candidate Bearer credentials on interpreter-only diagnostics', async () => {
    for (const role of ['admin', 'candidate']) {
      vi.mocked(actorFromBearer).mockResolvedValueOnce({
        userId: 'interpreter-profile-7', role, interpreterId: 7,
      } as never);
      const response = await GET(request('GET', 'Bearer different-role'));
      expect(response.status).toBe(403);
    }
    expect(prisma.userProfile.findUnique).not.toHaveBeenCalled();
    expect(prisma.callSession.count).not.toHaveBeenCalled();
  });

  it('denies a matching user with a different interpreter assignment before counting', async () => {
    vi.mocked(actorFromBearer).mockResolvedValueOnce({
      userId: 'interpreter-profile-7', role: 'interpreter', interpreterId: 99,
    } as never);
    vi.mocked(prisma.userProfile.findUnique).mockResolvedValueOnce({
      interpreterId: 7,
    } as never);
    const response = await GET(request('GET', 'Bearer wrong-interpreter'));
    expect(response.status).toBe(403);
    expect(prisma.callSession.count).not.toHaveBeenCalled();
    noMutations();
  });

  it('denies a credential resolver exception before any diagnostic read', async () => {
    vi.mocked(actorFromBearer).mockImplementationOnce(() => {
      throw new Error('Synthetic bearer resolver failure');
    });
    const response = await GET(request('GET', 'Bearer unavailable'));
    expect(response.status).toBe(403);
    expect(prisma.userProfile.findUnique).not.toHaveBeenCalled();
    expect(prisma.callSession.count).not.toHaveBeenCalled();
  });

  it('keeps POST permanently paused even with valid matching credentials', async () => {
    const response = await POST(request('POST', 'Bearer matched'));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('LEGACY_CALL_SYNC_PAUSED');
    expect(prisma.userProfile.findUnique).not.toHaveBeenCalled();
    expect(prisma.callSession.count).not.toHaveBeenCalled();
    noMutations();
  });

  it('rejects a mismatched Bearer on POST before any financial data access', async () => {
    vi.mocked(actorFromBearer).mockResolvedValueOnce({
      userId: 'another-user', role: 'interpreter', interpreterId: 8,
    } as never);
    const response = await POST(request('POST', 'Bearer other-user'));
    expect(response.status).toBe(403);
    expectPrivate(response);
    expect(prisma.userProfile.findUnique).not.toHaveBeenCalled();
    expect(prisma.callSession.count).not.toHaveBeenCalled();
    noMutations();
  });

  it('does not expose provider credentials from a failed GET', async () => {
    const error = new Error('postgresql://admin:PRIVATE_PASSWORD@internal.invalid/payroll');
    error.name = 'Bearer PRIVATE_TOKEN';
    vi.mocked(prisma.userProfile.findUnique).mockRejectedValueOnce(error);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await GET(request('GET'));
      expect(response.status).toBe(500);
      expectPrivate(response);
      expect(await response.json()).toEqual({
        success: false, error: 'Internal server error',
      });
      expect(spy).toHaveBeenCalledWith('Call sync GET failed:', 'Error');
      expect(JSON.stringify(spy.mock.calls)).not.toMatch(
        /PRIVATE_PASSWORD|PRIVATE_TOKEN|internal\.invalid|postgresql:\/\//,
      );
      noMutations();
    } finally { spy.mockRestore(); }
  });
});
