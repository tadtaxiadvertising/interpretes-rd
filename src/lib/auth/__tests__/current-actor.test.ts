import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCurrentActor, requireActor, requireRole, requireOwnership, CurrentActor } from '../current-actor';

// Mock dependencies
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(),
    },
  })),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    userProfile: {
      findUnique: vi.fn(),
    },
    interpreter: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('@/lib/auth-rbac', () => ({
  auth: vi.fn(),
}));

vi.mock('@/lib/admin-identity', () => ({
  resolveUserRoleByEmail: vi.fn((email, fallback) => (email === 'admin@test.com' ? 'admin' : fallback)),
}));

import { createClient } from '@/lib/supabase/server';
import prisma from '@/lib/prisma';
import { auth } from '@/lib/auth-rbac';
import { resolveUserRoleByEmail } from '@/lib/admin-identity';

describe('CurrentActor abstraction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Keep mock state isolated between tests. clearAllMocks() clears call history
    // but intentionally preserves implementations/return values.
    (prisma.userProfile.findUnique as any).mockResolvedValue(undefined);
    (prisma.interpreter.findFirst as any).mockResolvedValue(undefined);
  });

  describe('getCurrentActor', () => {
    it('returns null when no auth', async () => {
      const mockSupabase = {
        auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
      };
      (createClient as any).mockResolvedValue(mockSupabase);
      (auth as any).mockResolvedValue(null);

      const actor = await getCurrentActor();
      expect(actor).toBeNull();
    });

    it('resolves Supabase user with profile', async () => {
      const mockSupabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'user-123', email: 'test@test.com', user_metadata: { display_name: 'Test User' } } },
          }),
        },
      };
      (createClient as any).mockResolvedValue(mockSupabase);
      (prisma.userProfile.findUnique as any).mockResolvedValue({
        id: 'user-123',
        role: 'interpreter',
        interpreterId: 42,
        email: 'test@test.com',
      });
      (auth as any).mockResolvedValue(null);

      const actor = await getCurrentActor();

      expect(actor).toEqual({
        provider: 'supabase',
        userId: 'user-123',
        email: 'test@test.com',
        role: 'interpreter',
        interpreterId: 42,
        profileId: 'user-123',
      });
    });

    it('resolves admin role from email', async () => {
      const mockSupabase = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'admin-123', email: 'admin@test.com', user_metadata: { display_name: 'Admin' } } },
          }),
        },
      };
      (createClient as any).mockResolvedValue(mockSupabase);
      (prisma.userProfile.findUnique as any).mockResolvedValue({
        id: 'admin-123',
        role: 'interpreter', // profile says interpreter but email is admin
        interpreterId: null,
        email: 'admin@test.com',
      });
      (auth as any).mockResolvedValue(null);
      (resolveUserRoleByEmail as any).mockImplementation((email: string) => email === 'admin@test.com' ? 'admin' : 'interpreter');

      const actor = await getCurrentActor();

      expect(actor?.role).toBe('admin');
      expect(actor?.interpreterId).toBeNull();
    });

    it('falls back to Auth.js when Supabase not configured', async () => {
      (createClient as any).mockRejectedValue(new Error('Supabase not configured'));
      (prisma.userProfile.findUnique as any).mockResolvedValue(undefined);
      (prisma.interpreter.findFirst as any).mockResolvedValue(undefined);
      (auth as any).mockResolvedValue({
        user: {
          id: 'authjs-123',
          email: 'authjs@test.com',
          name: 'AuthJS User',
          role: 'interpreter',
          interpreterId: 99,
        },
      });

      const actor = await getCurrentActor();

      expect(actor).toEqual({
        provider: 'authjs',
        userId: 'authjs-123',
        email: 'authjs@test.com',
        role: 'interpreter',
        interpreterId: 99,
        profileId: null,
      });
    });
  });

  describe('requireActor', () => {
    it('throws when actor is null', () => {
      expect(() => requireActor(null)).toThrow('Not authenticated');
    });

    it('returns actor when present', () => {
      const actor: CurrentActor = {
        provider: 'supabase',
        userId: 'user-123',
        email: 'test@test.com',
        role: 'interpreter',
        interpreterId: 42,
        profileId: 'user-123',
      };
      expect(requireActor(actor)).toEqual(actor);
    });
  });

  describe('requireRole', () => {
    const baseActor: CurrentActor = {
      provider: 'supabase',
      userId: 'user-123',
      email: 'test@test.com',
      role: 'interpreter',
      interpreterId: 42,
      profileId: 'user-123',
    };

    it('allows matching role', () => {
      expect(() => requireRole(baseActor, ['interpreter'])).not.toThrow();
    });

    it('allows one of multiple roles', () => {
      expect(() => requireRole(baseActor, ['admin', 'interpreter'])).not.toThrow();
    });

    it('throws for non-matching role', () => {
      expect(() => requireRole(baseActor, ['admin'])).toThrow('Access denied: insufficient permissions');
    });
  });

  describe('requireOwnership', () => {
    const baseActor: CurrentActor = {
      provider: 'supabase',
      userId: 'user-123',
      email: 'test@test.com',
      role: 'interpreter',
      interpreterId: 42,
      profileId: 'user-123',
    };

    it('allows admin to access any resource', () => {
      const adminActor = { ...baseActor, role: 'admin' as const };
      expect(() => requireOwnership(adminActor, 99)).not.toThrow();
    });

    it('allows interpreter to access own resource', () => {
      expect(() => requireOwnership(baseActor, 42)).not.toThrow();
    });

    it('throws when interpreter accesses other resource', () => {
      expect(() => requireOwnership(baseActor, 99)).toThrow('Access denied: not your resource');
    });
  });
});
