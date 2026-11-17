// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
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
import prisma from '@/lib/prisma';
import { GET, POST } from '../route';

const request = (method: 'GET' | 'POST') =>
  new NextRequest('https://interpretes.example/api/calls/sync', { method });

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
