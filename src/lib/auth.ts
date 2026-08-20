import { createClient, isSupabaseConfigError } from './supabase/server';
import prisma from './prisma';
import { auth as nextAuth } from './auth-rbac';
import { resolveUserRoleByEmail } from './admin-identity';

/**
 * AUTH BRIDGE
 * Temporary wrapper to support legacy auth() calls using Supabase Auth.
 * This prevents breaking existing pages while we migrate to native Supabase patterns.
 */
export async function auth() {
  let user: any = null;

  try {
    const supabase = await createClient();
    const { data: { user: currentUser } } = await supabase.auth.getUser();

    if (currentUser) {
      const profile = await prisma.userProfile.findUnique({
        where: { id: currentUser.id },
        select: { role: true, displayName: true }
      });
      user = {
        ...currentUser,
        role: resolveUserRoleByEmail(currentUser.email, profile?.role || 'interpreter'),
        displayName: profile?.displayName || currentUser.email?.split('@')[0]
      };
    }
  } catch (error) {
    if (isSupabaseConfigError(error)) {
      console.warn(
        '⚠️ [AUTH_BRIDGE] Supabase configuration is missing; checking NextAuth session.'
      );
    } else {
      console.warn(
        '⚠️ [AUTH_BRIDGE] Unable to resolve Supabase session; checking NextAuth session:',
        error instanceof Error ? error.message : error
      );
    }
  }

  // Fallback to NextAuth session
  if (!user) {
    try {
      const session = await nextAuth();
      if (session?.user) {
        user = {
          id: session.user.id,
          email: session.user.email,
          role: resolveUserRoleByEmail(session.user.email, (session.user as any).role || 'interpreter'),
          displayName: session.user.name || session.user.email?.split('@')[0]
        };
      }
    } catch (authError) {
      console.warn('⚠️ [AUTH_BRIDGE] NextAuth session check failed:', authError);
    }
  }
  
  return { 
    userId: user?.id || null,
    user: user
  };
}

// Legacy session functions (no-op as Supabase handles this)
export async function getSession() {
  const { userId } = await auth();
  if (!userId) return null;
  return { userId };
}

export async function destroySession() {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch (error) {
    if (isSupabaseConfigError(error)) {
      console.warn('⚠️ [AUTH_BRIDGE] Supabase configuration is missing; sign out skipped.');
      return;
    }
    throw error;
  }
}
