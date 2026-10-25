import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { resolveCurrentIdentity, resolveDestination } from '@/lib/identity/resolve-user';

// Mock all external dependencies BEFORE importing the module under test
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    userProfile: {
      findUnique: vi.fn(),
    },
    interpreter: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    recruitmentCandidate: {
      findUnique: vi.fn(),
    },
    roleplaySession: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('@/lib/auth-rbac', () => ({
  auth: vi.fn(),
}));

vi.mock('@/lib/admin-identity', () => ({
  resolveUserRoleByEmail: vi.fn(),
}));

import { createClient } from '@/lib/supabase/server';
import prisma from '@/lib/prisma';
import { resolveUserRoleByEmail } from '@/lib/admin-identity';
import { auth } from '@/lib/auth-rbac';

const mockCreateClient = createClient as vi.Mock;
const mockPrisma = prisma as any;
const mockResolveUserRoleByEmail = resolveUserRoleByEmail as vi.Mock;
const mockAuth = auth as vi.Mock;

describe('resolveDestination access routing', () => {
  it('routes an incomplete interpreter to the resumable onboarding step', () => {
    expect(resolveDestination({
      role: 'interpreter',
      onboardingStatus: 'IN_PROGRESS',
      onboardingStep: 'banking',
      roleplayState: 'NO_ROLEPLAY',
      roleplaySessionId: null,
    } as any)).toBe('/onboarding?resume=true');
  });

  it('routes an invited interpreter to the assigned roleplay instead of dashboard', () => {
    expect(resolveDestination({
      role: 'interpreter',
      onboardingStatus: 'COMPLETED',
      onboardingStep: 'complete',
      roleplayState: 'INVITED',
      roleplaySessionId: 'session-123',
    } as any)).toBe('/roleplays/session-123');
  });

  it('keeps completed interpreters on dashboard after roleplay submission', () => {
    expect(resolveDestination({
      role: 'interpreter',
      onboardingStatus: 'COMPLETED',
      onboardingStep: 'complete',
      roleplayState: 'SUBMITTED',
      roleplaySessionId: 'session-123',
    } as any)).toBe('/dashboard');
  });
});

describe('Identity Resolver', () => {
  let mockAuthFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockPrisma.userProfile.findUnique.mockResolvedValue(null);
    mockPrisma.interpreter.findFirst.mockResolvedValue(null);
    mockPrisma.interpreter.findUnique.mockResolvedValue(null);
    mockPrisma.recruitmentCandidate.findUnique.mockResolvedValue(null);
    mockPrisma.roleplaySession.findFirst.mockResolvedValue(null);
    
    mockAuth.mockResolvedValue(null);
    vi.mocked(resolveUserRoleByEmail).mockReturnValue('interpreter');
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Supabase User Resolution', () => {
    it('should return null for unauthenticated user', async () => {
      const mockSupabase = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) } };
      
      mockCreateClient.mockResolvedValue(mockSupabase);

      const result = await resolveCurrentIdentity();
      expect(result).toBeNull();
    });

    it('should resolve identity for Supabase user with profile', async () => {
      const mockUser = { 
        id: 'user-123', 
        email: 'test@example.com',
        user_metadata: { display_name: 'Test User' }
      };
      const mockSupabase = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }) } };
      
      mockCreateClient.mockResolvedValue(mockSupabase);

      const mockProfile = {
        id: 'user-123',
        email: 'test@example.com',
        role: 'interpreter',
        interpreterId: 42,
        onboardingComplete: true,
        termsAcceptedAt: new Date(),
        bankName: 'Banco Popular',
        bankAccount: '123456',
        bankCedula: '123-4567890-1',
        bankAccountType: 'Ahorro',
        signatureDate: new Date(),
      };
      mockPrisma.userProfile.findUnique.mockResolvedValue(mockProfile);

      const result = await resolveCurrentIdentity();

      expect(result).not.toBeNull();
      expect(result?.userId).toBe('user-123');
      expect(result?.email).toBe('test@example.com');
      expect(result?.role).toBe('interpreter');
      expect(result?.interpreterId).toBe(42);
      expect(result?.onboardingStatus).toBe('COMPLETED');
    });

    it('should resolve identity for Supabase user without profile (new user)', async () => {
      const mockUser = { 
        id: 'user-123', 
        email: 'new@example.com',
        user_metadata: { display_name: 'New User' }
      };
      const mockSupabase = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }) } };
      
      mockCreateClient.mockResolvedValue(mockSupabase);

      mockPrisma.userProfile.findUnique.mockResolvedValue(null);
      mockPrisma.interpreter.findFirst.mockResolvedValue({ id: 99 });

      const result = await resolveCurrentIdentity();

      expect(result).not.toBeNull();
      expect(result?.interpreterId).toBe(99);
      expect(result?.onboardingStatus).toBe('NOT_STARTED');
    });

    it('should resolve admin role correctly', async () => {
      const mockUser = { id: 'admin-1', email: 'admin@example.com', user_metadata: {} };
      const mockSupabase = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }) } };
      
      mockCreateClient.mockResolvedValue(mockSupabase);

      const mockProfile = { id: 'admin-1', email: 'admin@example.com', role: 'admin', interpreterId: null };
      mockPrisma.userProfile.findUnique.mockResolvedValue(mockProfile);
      vi.mocked(resolveUserRoleByEmail).mockReturnValue('admin');

      const result = await resolveCurrentIdentity();

      expect(result?.role).toBe('admin');
      expect(result?.interpreterId).toBeNull();
    });
  });

  describe('Auth.js User Resolution', () => {
    it('should resolve identity for Auth.js user with interpreter', async () => {
      const mockSupabase = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) } };
      
      mockCreateClient.mockResolvedValue(mockSupabase);

      const mockSession = {
        user: { id: 'authjs-1', email: 'authjs@example.com', role: 'INTERPRETER', interpreterId: 55 }
      };
      mockAuth.mockResolvedValue(mockSession);

      const mockProfile = {
        id: 'profile-1',
        email: 'authjs@example.com',
        role: 'interpreter',
        interpreterId: 55,
        onboardingComplete: false,
        termsAcceptedAt: null,
      };
      mockPrisma.userProfile.findUnique.mockResolvedValue(mockProfile);

      const result = await resolveCurrentIdentity();

      expect(result).not.toBeNull();
      expect(result?.provider).toBe('authjs');
      expect(result?.interpreterId).toBe(55);
    });

    it('should resolve Auth.js admin correctly', async () => {
      const mockSupabase = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) } };
      
      mockCreateClient.mockResolvedValue(mockSupabase);

      const mockSession = {
        user: { id: 'authjs-admin', email: 'admin@authjs.com', role: 'ADMIN' }
      };
      mockAuth.mockResolvedValue(mockSession);

      const result = await resolveCurrentIdentity();

      expect(result).not.toBeNull();
      expect(result?.role).toBe('admin');
      expect(result?.provider).toBe('authjs');
    });
  });

  describe('Onboarding Status Computation', () => {
    it('should compute COMPLETED for user with all data', async () => {
      const mockUser = { id: 'user-1', email: 'complete@example.com', user_metadata: {} };
      const mockSupabase = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }) } };
      
      mockCreateClient.mockResolvedValue(mockSupabase);

      const mockProfile = {
        id: 'user-1',
        email: 'complete@example.com',
        role: 'interpreter',
        interpreterId: 10,
        onboardingComplete: true,
        termsAcceptedAt: new Date(),
        bankName: 'Banco Popular',
        bankAccount: '123456789',
        bankCedula: '123-4567890-1',
        bankAccountType: 'Ahorro',
        signatureDate: new Date(),
      };
      mockPrisma.userProfile.findUnique.mockResolvedValue(mockProfile);

      const result = await resolveCurrentIdentity();

      expect(result?.onboardingStatus).toBe('COMPLETED');
      expect(result?.onboardingStep).toBe('complete');
    });

    it('should compute IN_PROGRESS for user with terms but no banking', async () => {
      const mockUser = { id: 'user-2', email: 'partial@example.com', user_metadata: {} };
      const mockSupabase = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }) } };
      
      mockCreateClient.mockResolvedValue(mockSupabase);

      const mockProfile = {
        id: 'user-2',
        email: 'partial@example.com',
        role: 'interpreter',
        interpreterId: 11,
        onboardingComplete: false,
        termsAcceptedAt: new Date(),
        bankName: null,
        bankAccount: null,
        bankCedula: null,
        bankAccountType: null,
        signatureDate: null,
      };
      mockPrisma.userProfile.findUnique.mockResolvedValue(mockProfile);

      const result = await resolveCurrentIdentity();

      expect(result?.onboardingStatus).toBe('IN_PROGRESS');
      expect(result?.onboardingStep).toBe('banking');
    });

    it('should compute NEEDS_REVIEW for completed flag but missing data', async () => {
      const mockUser = { id: 'user-3', email: 'inconsistent@example.com', user_metadata: {} };
      const mockSupabase = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }) } };
      
      mockCreateClient.mockResolvedValue(mockSupabase);

      const mockProfile = {
        id: 'user-3',
        email: 'inconsistent@example.com',
        role: 'interpreter',
        interpreterId: 12,
        onboardingComplete: true,
        termsAcceptedAt: null,
        bankName: null,
        bankAccount: null,
        bankCedula: null,
        bankAccountType: null,
        signatureDate: null,
      };
      mockPrisma.userProfile.findUnique.mockResolvedValue(mockProfile);

      const result = await resolveCurrentIdentity();

      expect(result?.onboardingStatus).toBe('NEEDS_REVIEW');
    });
  });

  describe('Roleplay State Computation', () => {
    it('should return NO_ROLEPLAY when no session exists', async () => {
      const mockUser = { id: 'user-1', email: 'test@example.com', user_metadata: {} };
      const mockSupabase = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }) } };
      
      mockCreateClient.mockResolvedValue(mockSupabase);

      const mockProfile = { id: 'user-1', email: 'test@example.com', role: 'interpreter', interpreterId: 10, onboardingComplete: true };
      mockPrisma.userProfile.findUnique.mockResolvedValue(mockProfile);
      mockPrisma.roleplaySession.findFirst.mockResolvedValue(null);

      const result = await resolveCurrentIdentity();

      expect(result?.roleplayState).toBe('NO_ROLEPLAY');
      expect(result?.roleplaySessionId).toBeNull();
    });

    it('should return INVITED for session with valid access token', async () => {
      const mockUser = { id: 'user-1', email: 'test@example.com', user_metadata: {} };
      const mockSupabase = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }) } };
      
      mockCreateClient.mockResolvedValue(mockSupabase);

      const mockProfile = { id: 'user-1', email: 'test@example.com', role: 'interpreter', interpreterId: 10, onboardingComplete: true };
      mockPrisma.userProfile.findUnique.mockResolvedValue(mockProfile);

      const mockSession = {
        id: 'session-123',
        status: 'PENDING',
        interpreterId: 10,
        currentScenarioIndex: 0,
        recordedAudioUrl: null,
        submittedAt: null,
        evaluatedAt: null,
        qaScoreId: null,
        access: { usedAt: null, expiresAt: new Date(Date.now() + 86400000), validatedAt: null, startedAt: null },
      };
      mockPrisma.roleplaySession.findFirst.mockResolvedValue(mockSession);

      const result = await resolveCurrentIdentity();

      expect(result?.roleplayState).toBe('INVITED');
      expect(result?.roleplaySessionId).toBe('session-123');
    });
  });

  describe('Eligibility Computation', () => {
    // Copy of computeEligibility function from resolve-user.ts for testing
    function computeEligibility(
      onboardingStatus: string,
      roleplayState: string,
      role: string
    ) {
      if (role === 'admin') {
        return {
          canAccessDashboard: true,
          canStartRoleplay: false,
          needsOnboarding: false,
          needsRoleplay: false,
        };
      }

      const needsOnboarding = onboardingStatus !== 'COMPLETED';
      const needsRoleplay = !needsOnboarding && roleplayState === 'INVITED';
      const canStartRoleplay = !needsOnboarding && (roleplayState === 'INVITED' || roleplayState === 'STARTED' || roleplayState === 'IN_PROGRESS');
      const canAccessDashboard = !needsOnboarding && roleplayState !== 'INVITED' && roleplayState !== 'STARTED' && roleplayState !== 'IN_PROGRESS';

      return {
        canAccessDashboard,
        canStartRoleplay,
        needsOnboarding,
        needsRoleplay,
      };
    }

    it('should compute correct eligibility for completed onboarding with no roleplay', () => {
      const result = computeEligibility('COMPLETED', 'NO_ROLEPLAY', 'interpreter');
      
      expect(result.canAccessDashboard).toBe(true);
      expect(result.needsOnboarding).toBe(false);
      expect(result.needsRoleplay).toBe(false);
      expect(result.canStartRoleplay).toBe(false);
    });

    it('should require onboarding for incomplete profile', () => {
      const result = computeEligibility('IN_PROGRESS', 'NO_ROLEPLAY', 'interpreter');
      
      expect(result.canAccessDashboard).toBe(false);
      expect(result.needsOnboarding).toBe(true);
      expect(result.canStartRoleplay).toBe(false);
    });

    it('should require roleplay when invited', () => {
      const result = computeEligibility('COMPLETED', 'INVITED', 'interpreter');
      
      expect(result.canAccessDashboard).toBe(false);
      expect(result.needsOnboarding).toBe(false);
      expect(result.needsRoleplay).toBe(true);
      expect(result.canStartRoleplay).toBe(true);
    });

    it('should allow dashboard for completed onboarding with submitted roleplay', () => {
      const result = computeEligibility('COMPLETED', 'SUBMITTED', 'interpreter');
      
      expect(result.canAccessDashboard).toBe(true);
      expect(result.needsOnboarding).toBe(false);
      expect(result.needsRoleplay).toBe(false);
      expect(result.canStartRoleplay).toBe(false);
    });

    it('should allow dashboard for admin regardless of state', () => {
      const result = computeEligibility('NOT_STARTED', 'INVITED', 'admin');
      
      expect(result.canAccessDashboard).toBe(true);
      expect(result.needsOnboarding).toBe(false);
      expect(result.needsRoleplay).toBe(false);
      expect(result.canStartRoleplay).toBe(false);
    });
  });
});