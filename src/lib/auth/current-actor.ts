import { createClient } from '@/lib/supabase/server';
import prisma from '@/lib/prisma';
import { cache } from 'react';
import { UserRole } from '@/lib/types';
import { auth } from '@/lib/auth-rbac';
import { resolveUserRoleByEmail } from '@/lib/admin-identity';

export type AuthProvider = 'supabase' | 'authjs';

export type CurrentActor = {
  provider: AuthProvider;
  userId: string;
  email: string | null;
  role: UserRole;
  interpreterId: number | null;
  candidateId: number | null;
  profileId: string | null;
};

function normalizeRbacRole(role: string | null | undefined): UserRole {
  const normalized = role?.toLowerCase();
  if (normalized === 'admin') return 'admin';
  if (normalized === 'candidate') return 'candidate';
  return 'interpreter';
}

async function resolveRecruitmentIdentity(email: string, fallbackRole: UserRole, fallbackInterpreterId: number | null) {
  const candidate = await prisma.recruitmentCandidate.findUnique({
    where: { email },
    select: {
      id: true,
      applications: {
        select: { status: true, hiredInterpreterId: true },
        take: 1,
        orderBy: { createdAt: 'desc' },
      },
    },
  });
  const application = candidate?.applications[0];
  if (fallbackRole === 'admin') {
    return { role: 'admin' as UserRole, candidateId: candidate?.id ?? null, interpreterId: null };
  }
  if (candidate && application?.status !== 'HIRED') {
    return { role: 'candidate' as UserRole, candidateId: candidate.id, interpreterId: null };
  }
  if (candidate && application?.status === 'HIRED') {
    return {
      role: 'interpreter' as UserRole,
      candidateId: candidate.id,
      interpreterId: application.hiredInterpreterId ?? fallbackInterpreterId,
    };
  }
  return { role: fallbackRole, candidateId: null, interpreterId: fallbackInterpreterId };
}

async function resolveActorFromSupabase(
  supabaseUser: { id: string; email?: string | null; user_metadata?: { display_name?: string } }
): Promise<CurrentActor | null> {
  const userId = supabaseUser.id;
  const email = supabaseUser.email?.toLowerCase().trim() || null;
  if (!email) return null;

  const profile = await prisma.userProfile.findUnique({
    where: { id: userId },
    select: { id: true, role: true, interpreterId: true, email: true },
  });
  const fallbackRole = resolveUserRoleByEmail(profile?.email ?? email, profile?.role ?? 'interpreter');
  let interpreterId = fallbackRole === 'admin' || fallbackRole === 'candidate' ? null : (profile?.interpreterId ?? null);
  if (fallbackRole !== 'admin' && fallbackRole !== 'candidate' && !interpreterId) {
    const interpreter = await prisma.interpreter.findFirst({
      where: { emailCorporativo: email },
      select: { id: true },
    });
    interpreterId = interpreter?.id ?? null;
  }

  const recruitment = await resolveRecruitmentIdentity(email, fallbackRole, interpreterId);
  return {
    provider: 'supabase',
    userId,
    email,
    role: recruitment.role,
    interpreterId: recruitment.interpreterId,
    candidateId: recruitment.candidateId,
    profileId: profile?.id ?? null,
  };
}

async function resolveActorFromAuthJs(): Promise<CurrentActor | null> {
  try {
    const session = await auth();
    if (!session?.user?.id) return null;
    const userId = session.user.id;
    const email = session.user.email?.toLowerCase().trim() || null;
    if (!email) return null;

    const profile = await prisma.userProfile.findUnique({
      where: { email },
      select: { id: true, interpreterId: true, role: true },
    });
    const fallbackRole = normalizeRbacRole((session.user as any).role ?? profile?.role);
    const sessionInterpreterId = (session.user as any).interpreterId;
    let interpreterId = profile?.interpreterId ?? (typeof sessionInterpreterId === 'number' ? sessionInterpreterId : null);
    if (fallbackRole !== 'admin' && fallbackRole !== 'candidate' && !interpreterId) {
      const interpreter = await prisma.interpreter.findFirst({
        where: { emailCorporativo: email },
        select: { id: true },
      });
      interpreterId = interpreter?.id ?? null;
    }

    const recruitment = await resolveRecruitmentIdentity(email, fallbackRole, interpreterId);
    return {
      provider: 'authjs',
      userId,
      email,
      role: recruitment.role,
      interpreterId: recruitment.interpreterId,
      candidateId: recruitment.candidateId,
      profileId: profile?.id ?? null,
    };
  } catch {
    return null;
  }
}

export const getCurrentActor = cache(async (): Promise<CurrentActor | null> => {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const actor = await resolveActorFromSupabase(user);
      if (actor) return actor;
    }
  } catch {
    // Supabase not configured, fall through to Auth.js.
  }
  return await resolveActorFromAuthJs();
});

export function requireActor(actor: CurrentActor | null): CurrentActor {
  if (!actor) throw new Error('Not authenticated');
  return actor;
}

export function requireRole(actor: CurrentActor | null, requiredRoles: UserRole[]): CurrentActor {
  const a = requireActor(actor);
  if (!requiredRoles.includes(a.role)) throw new Error('Access denied: insufficient permissions');
  return a;
}

export function requireOwnership(actor: CurrentActor | null, resourceInterpreterId: number | null): CurrentActor {
  const a = requireActor(actor);
  if (a.role !== 'admin' && a.interpreterId !== resourceInterpreterId) {
    throw new Error('Access denied: not your resource');
  }
  return a;
}
