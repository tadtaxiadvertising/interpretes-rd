import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCurrentProfile } from '../auth';

const { prismaMock, getCurrentActorMock } = vi.hoisted(() => ({
  prismaMock: {
    userProfile: { findUnique: vi.fn(), update: vi.fn() },
  },
  getCurrentActorMock: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ default: prismaMock }));
vi.mock('@/lib/auth/current-actor', () => ({ getCurrentActor: getCurrentActorMock }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  isSupabaseConfigError: vi.fn(() => false),
}));
vi.mock('@/lib/supabase/admin', () => ({ getSupabaseServiceRoleKey: vi.fn() }));
vi.mock('@/lib/supabase/auth-users', () => ({
  upsertConfirmedAuthUser: vi.fn(),
  repairAuthUser: vi.fn(),
}));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));

describe('getCurrentProfile identity consistency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.userProfile.findUnique.mockResolvedValue({
      id: 'profile-uuid',
      email: 'interpreter@example.com',
      role: 'interpreter',
      interpreterId: null,
      displayName: 'Test Interpreter',
      termsAcceptedAt: null,
      signatureDate: null,
      bankName: null,
      bankAccount: null,
      bankAccountType: null,
      bankCedula: null,
      onboardingComplete: false,
      createdAt: new Date('2026-11-01T00:00:00.000Z'),
      interpreter: null,
    });
    prismaMock.userProfile.update.mockResolvedValue({});
  });

  it('persists the exact-email interpreter link already resolved by CurrentActor', async () => {
    getCurrentActorMock.mockResolvedValue({
      userId: 'auth-user',
      email: 'interpreter@example.com',
      role: 'interpreter',
      interpreterId: 42,
      candidateId: null,
      profileId: 'profile-uuid',
      authSource: 'authjs',
    });

    const profile = await getCurrentProfile();

    expect(profile?.interpreter_id).toBe(42);
    expect(prismaMock.userProfile.update).toHaveBeenCalledWith({
      where: { id: 'profile-uuid' },
      data: { role: 'interpreter', interpreterId: 42 },
    });
  });

  it('clears stale interpreter links when the resolved identity is a candidate', async () => {
    getCurrentActorMock.mockResolvedValue({
      userId: 'auth-user',
      email: 'candidate@example.com',
      role: 'candidate',
      interpreterId: null,
      candidateId: 9,
      profileId: 'profile-uuid',
      authSource: 'supabase',
    });
    prismaMock.userProfile.findUnique.mockResolvedValue({
      id: 'profile-uuid',
      email: 'candidate@example.com',
      role: 'candidate',
      interpreterId: 42,
      displayName: 'Test Candidate',
      termsAcceptedAt: null,
      signatureDate: null,
      bankName: null,
      bankAccount: null,
      bankAccountType: null,
      bankCedula: null,
      onboardingComplete: false,
      createdAt: new Date('2026-11-01T00:00:00.000Z'),
      interpreter: { id: 42 },
    });

    const profile = await getCurrentProfile();

    expect(profile?.role).toBe('candidate');
    expect(profile?.interpreter_id).toBeNull();
    expect(prismaMock.userProfile.update).toHaveBeenCalledWith({
      where: { id: 'profile-uuid' },
      data: { role: 'candidate', interpreterId: null },
    });
  });
});
