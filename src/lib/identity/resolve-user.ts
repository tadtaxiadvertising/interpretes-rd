import { createClient } from '@/lib/supabase/server';
import prisma from '@/lib/prisma';
import { cache } from 'react';
import { UserRole } from '@/lib/types';
import { auth } from '@/lib/auth-rbac';
import { resolveUserRoleByEmail } from '@/lib/admin-identity';

export type AuthProvider = 'supabase' | 'authjs';

export type OnboardingStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'NEEDS_REVIEW';

export type RoleplayState = 
  | 'NO_ROLEPLAY' 
  | 'DRAFT'
  | 'INVITED' 
  | 'STARTED' 
  | 'IN_PROGRESS' 
  | 'SUBMITTED' 
  | 'UNDER_REVIEW' 
  | 'EVALUATED' 
  | 'PASSED' 
  | 'FAILED' 
  | 'EXPIRED' 
  | 'CANCELLED';

export type ResolvedIdentity = {
  userId: string;
  profileId: string | null;
  interpreterId: number | null;
  candidateId: number | null;
  email: string | null;
  role: UserRole;
  provider: AuthProvider;
  onboardingStatus: OnboardingStatus;
  onboardingStep: 'legal' | 'banking' | 'tutorial' | 'complete' | null;
  onboardingVersion: number;
  onboardingCompletedAt: Date | null;
  roleplayState: RoleplayState;
  roleplaySessionId: string | null;
  eligibility: {
    canAccessDashboard: boolean;
    canStartRoleplay: boolean;
    needsOnboarding: boolean;
    needsRoleplay: boolean;
  };
};

function normalizeRbacRole(role: string | null | undefined): UserRole {
  return role?.toLowerCase() === 'admin' ? 'admin' : 'interpreter';
}

function computeOnboardingStatus(profile: {
  onboardingComplete: boolean;
  termsAcceptedAt: Date | null;
  bankName: string | null;
  bankAccount: string | null;
  bankCedula: string | null;
  bankAccountType: string | null;
  signatureDate: Date | null;
}, interpreter: {
  documentosCompleto: boolean | null;
  banco: string | null;
  cuentaPago: string | null;
  cedulaRnc: string | null;
  notas: string | null;
} | null, isAuthJsUser: boolean): {
  status: OnboardingStatus;
  step: 'legal' | 'banking' | 'tutorial' | 'complete' | null;
  version: number;
  completedAt: Date | null;
} {
  // For Auth.js users, onboarding state lives on Interpreter
  if (isAuthJsUser && interpreter) {
    const hasTerms = !!interpreter.documentosCompleto || interpreter.notas?.includes('[TERMS_ACCEPTED]');
    const hasBanking = !!(interpreter.banco && interpreter.cuentaPago && interpreter.cedulaRnc);
    
    if (interpreter.documentosCompleto) {
      return { status: 'COMPLETED', step: 'complete', version: 1, completedAt: new Date() }; // approximate
    }
    if (hasTerms && hasBanking) {
      return { status: 'IN_PROGRESS', step: 'tutorial', version: 1, completedAt: null };
    }
    if (hasTerms) {
      return { status: 'IN_PROGRESS', step: 'banking', version: 1, completedAt: null };
    }
    return { status: 'NOT_STARTED', step: 'legal', version: 1, completedAt: null };
  }

  // For Supabase users, onboarding state lives on UserProfile
  const hasTerms = !!profile.termsAcceptedAt;
  const hasBanking = !!(profile.bankName && profile.bankAccount && profile.bankCedula);
  
  if (profile.onboardingComplete) {
    // Check for NEEDS_REVIEW - completed flag but missing data
    if (!hasTerms || !hasBanking) {
      return { status: 'NEEDS_REVIEW', step: hasTerms ? 'banking' : 'legal', version: 1, completedAt: null };
    }
    return { status: 'COMPLETED', step: 'complete', version: 1, completedAt: profile.signatureDate };
  }
  
  if (hasTerms && hasBanking) {
    return { status: 'IN_PROGRESS', step: 'tutorial', version: 1, completedAt: null };
  }
  if (hasTerms) {
    return { status: 'IN_PROGRESS', step: 'banking', version: 1, completedAt: null };
  }
  return { status: 'NOT_STARTED', step: 'legal', version: 1, completedAt: null };
}

function computeRoleplayState(session: {
  id: string;
  status: string;
  interpreterId: number | null;
  recruitmentCandidateId: number | null;
  currentScenarioIndex: number;
  recordedAudioUrl: string | null;
  submittedAt: Date | null;
  evaluatedAt: Date | null;
  qaScoreId: number | null;
  access: { usedAt: Date | null; expiresAt: Date; validatedAt: Date | null; startedAt: Date | null } | null;
} | null, targetInterpreterId: number | null, targetCandidateId: number | null): {
  state: RoleplayState;
  sessionId: string | null;
} {
  if (!session) {
    return { state: 'NO_ROLEPLAY', sessionId: null };
  }

// Map current status to new state machine
  // PENDING is a legacy status not in the current RoleplayStatus enum;
  // treated as INVITED for backward compatibility via the default case.
  switch (session.status) {
    case 'EVALUATED':
      if (session.qaScoreId) {
        // Would need to check QAScore for criticalError or totalScore to determine PASSED/FAILED
        return { state: 'EVALUATED', sessionId: session.id };
      }
      return { state: 'EVALUATED', sessionId: session.id };
      
    default:
      return { state: 'INVITED', sessionId: session.id };
  }
}

export function computeEligibility(
  onboardingStatus: OnboardingStatus,
  roleplayState: RoleplayState,
  role: UserRole
): ResolvedIdentity['eligibility'] {
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

async function resolveActorFromSupabase(
  supabaseUser: { id: string; email?: string | null; user_metadata?: { display_name?: string } }
): Promise<ResolvedIdentity | null> {
  const userId = supabaseUser.id;
  const email = supabaseUser.email?.toLowerCase().trim() || null;

  if (!email) return null;

  // Fetch profile
  const profile = await prisma.userProfile.findUnique({
    where: { id: userId },
    include: {
      interpreter: {
        select: {
          id: true,
          documentosCompleto: true,
          banco: true,
          cuentaPago: true,
          cedulaRnc: true,
          notas: true,
        }
      }
    }
  });

  let resolvedRole: UserRole = 'interpreter';
  let interpreterId: number | null = profile?.interpreterId ?? null;
  let candidateId: number | null = null;

  if (profile) {
    resolvedRole = resolveUserRoleByEmail(profile.email, profile.role);
    interpreterId = resolvedRole === 'admin' ? null : (profile.interpreterId ?? null);
  } else {
    resolvedRole = resolveUserRoleByEmail(email, 'interpreter');
  }

  // If no interpreterId linked, try to find by email (migration/repair fallback)
  if (resolvedRole !== 'admin' && !interpreterId) {
    // Resolve ownership only by the authoritative corporate email.
    // Display names may be duplicated or user-editable and are not identity proof.
    const interpreter = await prisma.interpreter.findFirst({
      where: { emailCorporativo: email },
      select: { id: true },
    });
    interpreterId = interpreter?.id ?? null;
  }

  // Check for active roleplay session
  let roleplaySession: any = null;
  if (interpreterId) {
    roleplaySession = await prisma.roleplaySession.findFirst({
      where: { 
        interpreterId, 
        status: { in: ['DRAFT', 'INVITED', 'STARTED', 'IN_PROGRESS', 'SUBMITTED', 'UNDER_REVIEW', 'EVALUATED'] } 
      },
      include: { access: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  const isAuthJsUser = false; // Supabase user
  const onboarding = computeOnboardingStatus(
    { 
      onboardingComplete: profile?.onboardingComplete ?? false,
      termsAcceptedAt: profile?.termsAcceptedAt ?? null,
      bankName: profile?.bankName ?? null,
      bankAccount: profile?.bankAccount ?? null,
      bankCedula: profile?.bankCedula ?? null,
      bankAccountType: profile?.bankAccountType ?? null,
      signatureDate: profile?.signatureDate ?? null,
    },
    profile?.interpreter ?? null,
    isAuthJsUser
  );

  const roleplay = computeRoleplayState(roleplaySession, interpreterId, candidateId);
  const eligibility = computeEligibility(onboarding.status, roleplay.state, resolvedRole);

  return {
    userId,
    profileId: profile?.id ?? null,
    interpreterId,
    candidateId,
    email,
    role: resolvedRole,
    provider: 'supabase',
    onboardingStatus: onboarding.status,
    onboardingStep: onboarding.step,
    onboardingVersion: onboarding.version,
    onboardingCompletedAt: onboarding.completedAt,
    roleplayState: roleplay.state,
    roleplaySessionId: roleplay.sessionId,
    eligibility,
  };
}

async function resolveActorFromAuthJs(): Promise<ResolvedIdentity | null> {
  try {
    const session = await auth();
    if (!session?.user) return null;

    const userId = session.user.id;
    const email = session.user.email?.toLowerCase().trim() || null;
    const role = normalizeRbacRole((session.user as any).role);
    const interpreterId = (session.user as any).interpreterId ?? null;

    if (!email) return null;

    let candidateId: number | null = null;
    let profileId: string | null = null;

    // For Auth.js users, try to find linked profile
    const profile = await prisma.userProfile.findUnique({
      where: { email },
      include: {
        interpreter: {
          select: {
            id: true,
            documentosCompleto: true,
            banco: true,
            cuentaPago: true,
            cedulaRnc: true,
            notas: true,
          }
        }
      }
    });
    profileId = profile?.id ?? null;

    // If no interpreterId in session, try to find by email
    let resolvedInterpreterId = interpreterId;
    if (role !== 'admin' && !resolvedInterpreterId) {
      const interpreter = await prisma.interpreter.findFirst({
        where: { emailCorporativo: email },
        select: { id: true },
      });
      resolvedInterpreterId = interpreter?.id ?? null;
    }

    // Check for active roleplay session
    let roleplaySession: any = null;
    if (resolvedInterpreterId) {
      roleplaySession = await prisma.roleplaySession.findFirst({
        where: { 
          interpreterId: resolvedInterpreterId, 
          status: { in: ['DRAFT', 'INVITED', 'STARTED', 'IN_PROGRESS', 'SUBMITTED', 'UNDER_REVIEW', 'EVALUATED'] } 
        },
        include: { access: true },
        orderBy: { createdAt: 'desc' },
      });
    }

    const isAuthJsUser = true;
    const onboarding = computeOnboardingStatus(
      { 
        onboardingComplete: profile?.onboardingComplete ?? false,
        termsAcceptedAt: profile?.termsAcceptedAt ?? null,
        bankName: profile?.bankName ?? null,
        bankAccount: profile?.bankAccount ?? null,
        bankCedula: profile?.bankCedula ?? null,
        bankAccountType: profile?.bankAccountType ?? null,
        signatureDate: profile?.signatureDate ?? null,
      },
      profile?.interpreter ?? null,
      isAuthJsUser
    );

    const roleplay = computeRoleplayState(roleplaySession, resolvedInterpreterId, candidateId);
    const eligibility = computeEligibility(onboarding.status, roleplay.state, role);

    return {
      userId,
      profileId,
      interpreterId: resolvedInterpreterId,
      candidateId,
      email,
      role,
      provider: 'authjs',
      onboardingStatus: onboarding.status,
      onboardingStep: onboarding.step,
      onboardingVersion: onboarding.version,
      onboardingCompletedAt: onboarding.completedAt,
      roleplayState: roleplay.state,
      roleplaySessionId: roleplay.sessionId,
      eligibility,
    };
  } catch {
    return null;
  }
}

export const resolveCurrentIdentity = cache(async (): Promise<ResolvedIdentity | null> => {
  // Try Supabase first
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const identity = await resolveActorFromSupabase(user);
      if (identity) return identity;
    }
  } catch {
    // Supabase not configured or error, fall through to Auth.js
  }

  // Fallback to Auth.js
  return await resolveActorFromAuthJs();
});

export function requireIdentity(identity: ResolvedIdentity | null): ResolvedIdentity {
  if (!identity) {
    throw new Error('Not authenticated');
  }
  return identity;
}

export function requireRole(identity: ResolvedIdentity | null, requiredRoles: UserRole[]): ResolvedIdentity {
  const i = requireIdentity(identity);
  if (!requiredRoles.includes(i.role)) {
    throw new Error('Access denied: insufficient permissions');
  }
  return i;
}

export function requireOwnership(
  identity: ResolvedIdentity | null,
  resourceInterpreterId: number | null
): ResolvedIdentity {
  const i = requireIdentity(identity);
  if (i.role !== 'admin' && i.interpreterId !== resourceInterpreterId) {
    throw new Error('Access denied: not your resource');
  }
  return i;
}

export function resolveOnboardingState(identity: ResolvedIdentity): {
  status: OnboardingStatus;
  step: 'legal' | 'banking' | 'tutorial' | 'complete' | null;
  version: number;
  completedAt: Date | null;
} {
  // Use the onboardingStatus directly from the resolved identity,
  // as it was computed by resolveActorFromSupabase or resolveActorFromAuthJs
  const status = identity.onboardingStatus as OnboardingStatus;
  const step = identity.onboardingStep as 'legal' | 'banking' | 'tutorial' | 'complete' | null;
  const version = identity.onboardingVersion;
  const completedAt = identity.onboardingCompletedAt;
  return { status, step, version, completedAt };
}

export function resolveDestination(identity: ResolvedIdentity): string {
  // Admin always goes to admin panel
  if (identity.role === 'admin') {
    return '/admin';
  }

  // Check onboarding state
  const onboarding = resolveOnboardingState(identity);

  if (onboarding.status !== 'COMPLETED') {
    // User needs to complete or resume onboarding
    const resumeParam = onboarding.status === 'IN_PROGRESS' ? '?resume=true' : '';
    return `/onboarding${resumeParam}`;
  }

  // Onboarding complete - check roleplay state
  switch (identity.roleplayState) {
    case 'INVITED':
    case 'STARTED':
    case 'IN_PROGRESS':
      // User has an active roleplay session - go to roleplay
      if (identity.roleplaySessionId) {
        return `/roleplays/${identity.roleplaySessionId}`;
      }
      // Fallback if no session ID
      return '/dashboard/roleplays';

    case 'SUBMITTED':
    case 'UNDER_REVIEW':
    case 'EVALUATED':
      // Roleplay submitted or under review - show dashboard with status
      return '/dashboard';

    case 'PASSED':
    case 'FAILED':
      // Roleplay completed with result - show dashboard
      return '/dashboard';

    case 'EXPIRED':
    case 'CANCELLED':
      // Roleplay expired/cancelled - show dashboard
      return '/dashboard';

    case 'NO_ROLEPLAY':
    default:
      // No roleplay - go to dashboard
      return '/dashboard';
  }
}