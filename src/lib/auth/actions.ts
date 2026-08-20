import { createClient } from '@/lib/supabase/server';
import prisma from '@/lib/prisma';
import { ActionResult, UserRole } from '@/lib/types';
import { cache } from 'react';
import { auth } from '@/lib/auth-rbac';
import { resolveUserRoleByEmail } from '@/lib/admin-identity';

/**
 * CACHED AUTH HELPER
 * ============================================================
 * Deduplicates authentication calls within the same request.
 * ============================================================
 */
export const getCurrentUser = cache(async () => {
  let supabaseUser = null;
  let supabaseProfile = null;

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      supabaseUser = user;
      supabaseProfile = await prisma.userProfile.findUnique({
        where: { id: user.id },
        select: {
          id: true,
          role: true,
          displayName: true,
          email: true,
          interpreterId: true
        }
      });

      // Self-healing: if the user exists in Supabase but has no userProfile record in the public schema
      if (!supabaseProfile && user.email) {
        console.log(`🔧 [AUTH] Self-healing profile auto-creation for user: ${user.email}`);

        // Default role is always 'interpreter' on auto-provision.
        // Admin must be assigned explicitly by an authorized operator
        // via admin action or direct DB assignment.
        const role: UserRole = resolveUserRoleByEmail(user.email, 'interpreter');

        // Link with an interpreter profile — broader matching (email or name)
        const interpreter = await prisma.interpreter.findFirst({
          where: {
            OR: [
              { emailCorporativo: user.email },
              { name: user.user_metadata?.display_name || user.email?.split('@')[0] },
            ],
          },
          select: { id: true }
        });

        // AUTO-CREATE: If no matching interpreter and role is 'interpreter', create one
        let interpreterId: number | null = role === 'admin' ? null : (interpreter?.id || null);
        if (!interpreterId && role === 'interpreter') {
          const displayName = user.user_metadata?.display_name || user.email?.split('@')[0] || 'Interpreter';
          try {
            const newInterp = await prisma.interpreter.create({
              data: {
                externalId: `auth-${user.id}`,
                name: displayName,
                emailCorporativo: user.email,
                status: 'Activo',
                realtimeStatus: 'Offline',
                tariffPerMinute: 0,
                monthlyGoal: 2000,
                languageA: 'Español',
                languageB: 'Inglés',
              },
              select: { id: true },
            });
            interpreterId = newInterp.id;
            console.log(`🔧 [AUTH] Interpreter auto-created for ${user.id} → interpreter ${newInterp.id}`);
          } catch (createErr: any) {
            if (createErr?.code === 'P2002') {
              // Unique constraint — find the existing one instead of creating a duplicate
              const existing = await prisma.interpreter.findFirst({
                where: {
                  OR: [
                    { emailCorporativo: user.email },
                    { externalId: `auth-${user.id}` },
                  ],
                },
                select: { id: true },
              });
              if (existing) {
                interpreterId = existing.id;
                console.log(`🔧 [AUTH] Interpreter already exists for ${user.id} → interpreter ${existing.id}`);
              } else {
                const fallbackInterp = await prisma.interpreter.create({
                  data: {
                    externalId: `auth-${user.id}-${Date.now()}`,
                    name: displayName,
                    status: 'Activo',
                    realtimeStatus: 'Offline',
                    tariffPerMinute: 0,
                    monthlyGoal: 2000,
                    languageA: 'Español',
                    languageB: 'Inglés',
                  },
                  select: { id: true },
                });
                interpreterId = fallbackInterp.id;
                console.log(`🔧 [AUTH] Interpreter auto-created (fallback) for ${user.id} → interpreter ${fallbackInterp.id}`);
              }
            } else {
              console.error('[AUTH] Interpreter auto-creation failed:', createErr);
            }
          }
        }

        // Safe creation of the profile
        supabaseProfile = await prisma.userProfile.create({
          data: {
            id: user.id,
            email: user.email,
            displayName: user.user_metadata?.display_name || user.email.split('@')[0],
            role: role,
            interpreterId: interpreterId
          },
          select: {
            id: true,
            role: true,
            displayName: true,
            email: true,
            interpreterId: true
          }
        });
      }

      // Admin promotion removed from runtime flow. Admin status is explicit-only;
      // granting admin requires a direct DB operation by an authorized operator.

      // Self-healing: link interpreter when profile exists but interpreterId is null (skip for admins)
      if (supabaseProfile && !supabaseProfile.interpreterId && supabaseUser?.email && supabaseProfile.role !== 'admin') {
        try {
          const interpreterMatch = await prisma.interpreter.findFirst({
            where: {
              OR: [
                { emailCorporativo: supabaseUser.email },
                { name: supabaseProfile.displayName || supabaseUser.email?.split('@')[0] },
              ],
            },
            select: { id: true },
          });

          if (interpreterMatch) {
            await prisma.userProfile.update({
              where: { id: supabaseProfile.id },
              data: { interpreterId: interpreterMatch.id },
            });
            supabaseProfile = { ...supabaseProfile, interpreterId: interpreterMatch.id };
            console.log(`🔧 [AUTH] Interpreter link auto-repaired for ${supabaseProfile.id} → interpreter ${interpreterMatch.id}`);
          } else if (supabaseProfile.role !== 'admin') {
            // AUTO-CREATE: No matching interpreter and user is not admin — create one and link it
            const displayName = supabaseProfile.displayName || supabaseUser.email?.split('@')[0] || 'Interpreter';
            let newInterpreter: { id: number } | null = null;
            try {
              newInterpreter = await prisma.interpreter.create({
                data: {
                  externalId: `auth-${supabaseProfile.id}`,
                  name: displayName,
                  emailCorporativo: supabaseUser.email,
                  status: 'Activo',
                  realtimeStatus: 'Offline',
                  tariffPerMinute: 0,
                  monthlyGoal: 2000,
                  languageA: 'Español',
                  languageB: 'Inglés',
                },
                select: { id: true },
              });
            } catch (createErr: any) {
              if (createErr?.code === 'P2002') {
                // Find existing instead of creating a duplicate
                const existing = await prisma.interpreter.findFirst({
                  where: {
                    OR: [
                      { emailCorporativo: supabaseUser.email },
                      { externalId: `auth-${supabaseProfile.id}` },
                    ],
                  },
                  select: { id: true },
                });
                if (existing) {
                  newInterpreter = existing;
                } else {
                  newInterpreter = await prisma.interpreter.create({
                    data: {
                      externalId: `auth-${supabaseProfile.id}-${Date.now()}`,
                      name: displayName,
                      status: 'Activo',
                      realtimeStatus: 'Offline',
                      tariffPerMinute: 0,
                      monthlyGoal: 2000,
                      languageA: 'Español',
                      languageB: 'Inglés',
                    },
                    select: { id: true },
                  });
                }
              } else {
                throw createErr;
              }
            }
            if (newInterpreter) {
              await prisma.userProfile.update({
                where: { id: supabaseProfile.id },
                data: { interpreterId: newInterpreter.id },
              });
              supabaseProfile = { ...supabaseProfile, interpreterId: newInterpreter.id };
              console.log(`🔧 [AUTH] Interpreter auto-created and linked for ${supabaseProfile.id} → interpreter ${newInterpreter.id}`);
            }
          }
        } catch (linkErr) {
          console.error('[AUTH] Interpreter link repair failed:', linkErr);
        }
      }
    }
  } catch (error) {
    // Supabase variables might be missing in RBAC-only environments (e.g. interpreters subproject)
    // We catch it here to allow clean fallback to Auth.js credentials session
  }

  if (supabaseUser) {
    return {
      ...supabaseUser,
      profile: supabaseProfile
    };
  }

  // Fallback to NextAuth (Auth.js) session
  try {
    const session = await auth();
    if (session?.user) {
      return {
        id: session.user.id,
        email: session.user.email,
        profile: {
          id: session.user.id,
          role: (session.user as any).role || 'interpreter',
          displayName: session.user.name,
          email: session.user.email,
          interpreterId: (session.user as any).interpreterId || null,
        }
      };
    }
  } catch (authError) {
    console.error('NextAuth Fallback Error:', authError);
  }

  return null;
});

/**
 * SERVER ACTION GUARD
 * ============================================================
 * Standardizes authentication and role checks for server actions.
 * ============================================================
 */
export async function validateAction(requiredRole?: UserRole | UserRole[]): Promise<{
  user: any;
  profile: any;
} | { error: string; code: NonNullable<ActionResult['code']> }> {
  const userData = await getCurrentUser();

  if (!userData) {
    return { error: 'Not authenticated', code: 'UNAUTHORIZED' };
  }

  if (requiredRole) {
    const roles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
    const userRole = (userData.profile?.role || 'interpreter').toLowerCase() as UserRole;

    if (!roles.includes(userRole)) {
      return { error: 'Access denied: insufficient permissions', code: 'UNAUTHORIZED' };
    }
  }

  return {
    user: userData,
    profile: userData.profile
  };
}
