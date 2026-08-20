'use server';

import { createClient, isSupabaseConfigError } from '@/lib/supabase/server';
import { getSupabaseServiceRoleKey } from '@/lib/supabase/admin';
import { upsertConfirmedAuthUser, repairAuthUser } from '@/lib/supabase/auth-users';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import type { UserProfile, UserRole } from '@/lib/types';
import { resolveRbacRoleByEmail, resolveUserRoleByEmail } from '@/lib/admin-identity';
import prismaClient from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

const prisma = prismaClient;

const AuthSchema = z.object({
  email: z.string().email().transform(val => val.toLowerCase().trim()),
  password: z.string().min(6),
  role: z.enum(['admin', 'interpreter']).default('interpreter'),
});

function normalizeRbacRole(role: string | null | undefined): UserRole {
  return role?.toLowerCase() === 'admin' ? 'admin' : 'interpreter';
}

async function syncUserProfileFromAuth(params: {
  userId: string;
  email: string;
  role: UserRole;
  displayName: string;
}) {
  const resolvedRole = resolveUserRoleByEmail(params.email, params.role);

  const interpreter = resolvedRole === 'admin' ? null : await prisma.interpreter.findFirst({
    where: {
      OR: [
        { emailCorporativo: params.email },
        { name: params.displayName },
      ],
    },
    select: { id: true },
  });

  await prisma.userProfile.upsert({
    where: { id: params.userId },
    update: {
      email: params.email,
      displayName: params.displayName,
      role: resolvedRole,
      interpreterId: resolvedRole === 'admin' ? null : (interpreter?.id ?? null),
    },
    create: {
      id: params.userId,
      email: params.email,
      displayName: params.displayName,
      role: resolvedRole,
      interpreterId: resolvedRole === 'admin' ? null : (interpreter?.id ?? null),
    },
  });
}

async function repairAuthUserAndRetry(params: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  email: string;
  password: string;
  requestedRole: UserRole;
}) {
  const serviceKey = getSupabaseServiceRoleKey();
  console.log(`🔧 [AUTH_REPAIR] Attempting repair for ${params.email} — serviceKey available: ${!!serviceKey}`);
  if (!serviceKey) {
    console.warn('⚠️ [AUTH_REPAIR] SUPABASE_SERVICE_ROLE_KEY not available — skipping repair.');
    return null;
  }

  // repairAuthUser handles the known failure modes without creating new users:
  //  - identities: null/empty → deletes broken user, recreates with proper identity link
  //  - email not confirmed → updates with email_confirm: true
  //  - user doesn't exist → returns null (no auto-creation for security)
  try {
    const repairedUser = await repairAuthUser({
      email: params.email,
      password: params.password,
      displayName: params.email.split('@')[0],
    });
    console.log(`🔧 [AUTH_REPAIR] repairAuthUser result for ${params.email}: ${repairedUser ? `id=${repairedUser.id} identities=${repairedUser.identities?.length ?? 'null'}` : 'null'}`);
    if (!repairedUser) return null;

    const retry = await params.supabase.auth.signInWithPassword({
      email: params.email,
      password: params.password,
    });
    console.log(`🔧 [AUTH_REPAIR] signInWithPassword retry for ${params.email}: ${retry.error ? `error=${retry.error.message}` : `success userId=${retry.data.user?.id}`}`);

    if (retry.error || !retry.data.user) {
      return {
        success: false,
        error: retry.error?.message || 'Credenciales inválidas o error de autenticación.',
      };
    }

    const profile = await prisma.userProfile.findUnique({
      where: { id: retry.data.user.id },
      select: { role: true },
    });

    if (!profile) {
      await syncUserProfileFromAuth({
        userId: retry.data.user.id,
        email: params.email,
        role: resolveUserRoleByEmail(params.email, params.requestedRole),
        displayName: repairedUser.user_metadata?.display_name || params.email.split('@')[0],
      });
    }

    console.log(`✅ [AUTH_REPAIR] Repair successful for ${params.email} — role=${profile?.role ?? params.requestedRole}`);
    return {
      success: true,
      role: resolveUserRoleByEmail(params.email, profile?.role ?? params.requestedRole),
    };
  } catch (repairErr) {
    console.error(`🔴 [AUTH_REPAIR] upsertConfirmedAuthUser threw for ${params.email}:`, repairErr);
    return null;
  }
}

/**
 * ACTION: User Login
 */
export async function login(formData: FormData) {
  const email = ((formData.get('email') as string) || '').toLowerCase().trim();
  const password = (formData.get('password') as string) || '';
  const requestedRole = ((formData.get('role') as string) || 'interpreter').toLowerCase() as UserRole;
  const effectiveRequestedRole = resolveUserRoleByEmail(email, requestedRole);

  try {
    const validated = AuthSchema.parse({ email, password, role: effectiveRequestedRole });
    const supabase = await createClient();

    const { data, error } = await supabase.auth.signInWithPassword({
      email: validated.email,
      password: validated.password,
    });

    if (error) {
      console.error(`🔴 [AUTH_LOGIN] Failed for ${email}:`, error.message);

      // Attempt admin API repair when the service key is available.
      // Handles: identities:null, unconfirmed email, missing user.
      if (getSupabaseServiceRoleKey()) {
        try {
          const repairedLogin = await repairAuthUserAndRetry({
            supabase,
            email,
            password,
            requestedRole: effectiveRequestedRole,
          });

          // Only short-circuit on success — on failure, fall through to
          // the local rbac_users fallback so we don't block users who
          // have a valid password in the local table.
          if (repairedLogin?.success) {
            const cookieStore = await cookies();
            cookieStore.set('user-role', repairedLogin.role || 'interpreter', { path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 60 * 60 * 24 * 7 });
            return repairedLogin;
          }
        } catch (repairError) {
          console.error(`🔴 [AUTH_LOGIN] Admin API repair failed for ${email}:`, repairError);
        }
      }

      // ── LOCAL RBAC FALLBACK ─────────────────────────────────
      // Authenticate against the rbac_users table (works even without
      // Supabase service key).
      console.log(`🔧 [AUTH_LOGIN] Falling through to local RBAC fallback for ${email}`);
      const localUser = await prisma.rbacUser.findUnique({
        where: { email },
        select: { id: true, email: true, name: true, role: true, password: true },
      });

      if (!localUser) {
        console.log(`🔴 [AUTH_LOGIN] No local RBAC user found for ${email}`);
        return { success: false, error: 'Credenciales inválidas o error de autenticación.' };
      }

      const passwordMatches = await bcrypt.compare(password, localUser.password);
      if (!passwordMatches) {
        console.log(`🔴 [AUTH_LOGIN] Local RBAC password mismatch for ${email}`);
        return { success: false, error: 'Credenciales inválidas o error de autenticación.' };
      }

      const localRole = resolveUserRoleByEmail(email, normalizeRbacRole(localUser.role));
      if (normalizeRbacRole(localUser.role) !== localRole) {
        await prisma.rbacUser.update({
          where: { id: localUser.id },
          data: { role: resolveRbacRoleByEmail(email, localUser.role) },
        });
      }
      if (effectiveRequestedRole !== localRole) {
        return {
          success: false,
          error: 'Estas credenciales no corresponden al portal seleccionado.',
        };
      }

      // Try to repair an existing Supabase Auth user (login still works via NextAuth).
      // If the user doesn't exist yet in Supabase Auth, skip provisioning —
      // the client falls through to NextAuth credentials provider instead.
      // This prevents unauthorized account creation from local-only credentials.
      if (getSupabaseServiceRoleKey()) {
        try {
          const displayName = localUser.name || email.split('@')[0];
          const repairedUser = await repairAuthUser({
            email,
            password,
            displayName,
          });

          if (repairedUser) {
            const retry = await supabase.auth.signInWithPassword({
              email: validated.email,
              password: validated.password,
            });
            if (!retry.error && retry.data.user) {
              await syncUserProfileFromAuth({
                userId: retry.data.user.id,
                email,
                role: resolveUserRoleByEmail(email, localRole),
                displayName,
              });
              const cookieStore = await cookies();
              cookieStore.set('user-role', localRole, { path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 60 * 60 * 24 * 7 });
              return { success: true, role: localRole };
            }
          }
        } catch (fallbackError) {
          console.error(`🔴 [AUTH_LOGIN] Supabase repair failed for ${email}:`, fallbackError);
        }
      }

      // ── NEXT AUTH SESSION ─────────────────────────────────
      const cookieStore = await cookies();
      cookieStore.set('user-role', localRole, { path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 60 * 60 * 24 * 7 });
      return { success: true, role: localRole, nextAuthRequired: true };
    }

    // Fetch minimal profile via Prisma
    const profile = await prisma.userProfile.findUnique({
      where: { id: data.user.id },
      select: { role: true },
    });

    if (!profile) {
      await syncUserProfileFromAuth({
        userId: data.user.id,
        email: validated.email,
        role: resolveUserRoleByEmail(validated.email, effectiveRequestedRole),
        displayName: data.user.user_metadata?.display_name || validated.email.split('@')[0],
      });
    }

    const finalRole = resolveUserRoleByEmail(validated.email, profile?.role ?? effectiveRequestedRole);

    if (profile?.role !== finalRole) {
      await prisma.userProfile.update({
        where: { id: data.user.id },
        data: { role: finalRole, interpreterId: finalRole === 'admin' ? null : undefined },
      });
    }
    const cookieStore3 = await cookies();
    cookieStore3.set('user-role', finalRole, { path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 60 * 60 * 24 * 7 });
    return { success: true, role: finalRole };
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return { success: false, error: 'Email o contraseña inválidos.' };
    }

    if (isSupabaseConfigError(err)) {
      console.warn('⚠️ [AUTH_LOGIN] Configuración de Supabase omitida.');
      return {
        success: false,
        error: 'El servicio de autenticación está temporalmente deshabilitado por falta de configuración.',
      };
    }

    console.error('🔴 [AUTH_LOGIN] Unexpected error:', err);
    return { success: false, error: 'Error interno del sistema.' };
  }
}

/**
 * ACTION: User Registration
 */
export async function register(formData: FormData) {
  const email = ((formData.get('email') as string) || '').toLowerCase().trim();
  const password = (formData.get('password') as string) || '';
  const name = (formData.get('name') as string) || email.split('@')[0];
  // Role is never taken from arbitrary client input. Registrations default to
  // interpreter, except protected owner identities that must stay admin.
  const role: UserRole = resolveUserRoleByEmail(email, 'interpreter');

  try {
    const validated = AuthSchema.parse({ email, password, role });
    const supabase = await createClient();
    let userId: string;

    const serviceKey = getSupabaseServiceRoleKey();
    if (serviceKey) {
      try {
        const authUser = await upsertConfirmedAuthUser({
          email: validated.email,
          password: validated.password,
          displayName: name,
        });

        if (!authUser) {
          return { success: false, error: 'No se pudo crear la cuenta.' };
        }
        userId = authUser.id;

        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: validated.email,
          password: validated.password,
        });
        if (signInError) {
          console.warn(`⚠️ [AUTH_REGISTER] Auto sign-in after create failed for ${validated.email}:`, signInError.message);
        }
      } catch (adminError) {
        console.error(`🔴 [AUTH_REGISTER] Admin API create failed for ${validated.email}:`, adminError);
        return { success: false, error: 'Error al crear la cuenta. Intente nuevamente.' };
      }
    } else {
      const { data, error } = await supabase.auth.signUp({
        email: validated.email,
        password: validated.password,
        options: { data: { display_name: name } },
      });

      if (error) return { success: false, error: error.message };
      if (!data.user) return { success: false, error: 'No se pudo crear el usuario.' };
      userId = data.user.id;
    }

    const resolvedRole = resolveUserRoleByEmail(validated.email, validated.role);

    const interpreter = resolvedRole === 'admin' ? null : await prisma.interpreter.findFirst({
      where: {
        OR: [
          { emailCorporativo: validated.email },
          { name: name },
        ],
      },
      select: { id: true },
    });

    await prisma.userProfile.upsert({
      where: { id: userId },
      update: {
        email: validated.email,
        displayName: name,
        role: resolvedRole,
        interpreterId: resolvedRole === 'admin' ? null : (interpreter?.id ?? null),
      },
      create: {
        id: userId,
        email: validated.email,
        displayName: name,
        role: resolvedRole,
        interpreterId: resolvedRole === 'admin' ? null : (interpreter?.id ?? null),
      },
    });

    try {
      const hashedPassword = await bcrypt.hash(validated.password, 10);
      await (prisma as any).rbacUser.upsert({
        where: { email: validated.email },
        update: { password: hashedPassword, name },
        create: {
          email: validated.email,
          password: hashedPassword,
          name,
          role: resolveRbacRoleByEmail(validated.email, validated.role.toUpperCase()),
        },
      });
    } catch (rbacSyncErr) {
      console.warn(`⚠️ [AUTH_REGISTER] rbac_users sync skipped for ${validated.email}:`, rbacSyncErr);
    }

    return { success: true, role: resolvedRole };
  } catch (err: unknown) {
    if (err instanceof z.ZodError) return { success: false, error: 'Datos de registro inválidos.' };

    if (isSupabaseConfigError(err)) {
      console.warn('⚠️ [AUTH_REGISTER] Configuración de Supabase omitida.');
      return {
        success: false,
        error: 'El servicio de registro está temporalmente deshabilitado por falta de configuración.',
      };
    }

    console.error('🔴 [AUTH_REGISTER] Error:', err);
    return { success: false, error: 'Error interno durante el registro.' };
  }
}

/**
 * ACTION: Get Current User Profile (Selective)
 */
export async function getCurrentProfile(): Promise<UserProfile | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    let profile = null;
    let profileUserId = user?.id;

    if (!profileUserId) {
      try {
        const { auth: nextAuth } = await import('@/lib/auth-rbac');
        const session = await nextAuth();
        if (session?.user) {
          const dbProfile = await prisma.userProfile.findFirst({
            where: {
              OR: [
                { id: session.user.id },
                { email: session.user.email || undefined }
              ]
            },
            select: { id: true }
          });
          if (dbProfile) {
            profileUserId = dbProfile.id;
          }
        }
      } catch (authError) {
        console.warn('⚠️ [AUTH] NextAuth session fallback failed in getCurrentProfile:', authError);
      }
    }

    if (profileUserId) {
      profile = await prisma.userProfile.findUnique({
        where: { id: profileUserId },
        select: {
          id: true,
          email: true,
          role: true,
          interpreterId: true,
          displayName: true,
          termsAcceptedAt: true,
          signatureDate: true,
          bankName: true,
          bankAccount: true,
          bankAccountType: true,
          bankCedula: true,
          onboardingComplete: true,
          createdAt: true,
          interpreter: {
            select: {
              id: true,
              externalId: true,
              name: true,
              status: true,
              realtimeStatus: true,
              tariffPerMinute: true,
              emailCorporativo: true,
            },
          },
        },
      });
    }

    if (!profile) return null;

    const resolvedRole = resolveUserRoleByEmail(profile.email, profile.role);
    if (profile.role !== resolvedRole) {
      await prisma.userProfile.update({
        where: { id: profile.id },
        data: { role: resolvedRole, interpreterId: resolvedRole === 'admin' ? null : undefined },
      });
      profile = { ...profile, role: resolvedRole, interpreterId: resolvedRole === 'admin' ? null : profile.interpreterId, interpreter: resolvedRole === 'admin' ? null : profile.interpreter };
    }

    // General admin promotion remains removed from runtime flow; only the
    // protected owner identity above is force-repaired so it cannot be
    // downgraded by auto-provisioning or sync paths.

    // Self-healing: link interpreter when profile exists but interpreterId is null (skip for admins)
    if (!profile.interpreterId && profile.email && profile.role !== 'admin') {
      try {
        const interpreterMatch = await prisma.interpreter.findFirst({
          where: {
            OR: [
              { emailCorporativo: profile.email },
              { name: profile.displayName || profile.email?.split('@')[0] },
            ],
          },
          select: { id: true },
        });

        if (interpreterMatch) {
          await prisma.userProfile.update({
            where: { id: profile.id },
            data: { interpreterId: interpreterMatch.id },
          });
          profile = { ...profile, interpreterId: interpreterMatch.id, interpreter: null };
          console.log(`🔧 [AUTH] Interpreter link auto-repaired in getCurrentProfile for ${profile.id} → interpreter ${interpreterMatch.id}`);
        } else if (profile.role !== 'admin') {
          // AUTO-CREATE: No matching interpreter — create one and link it
          const displayName = profile.displayName || profile.email?.split('@')[0] || 'Interpreter';
          let newInterpreter: { id: number } | null = null;
          try {
            newInterpreter = await prisma.interpreter.create({
              data: {
                externalId: `auth-${profile.id}`,
                name: displayName,
                emailCorporativo: profile.email,
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
              // Unique constraint violation — find the existing interpreter and link
              const existing = await prisma.interpreter.findFirst({
                where: {
                  OR: [
                    { emailCorporativo: profile.email },
                    { externalId: `auth-${profile.id}` },
                  ],
                },
                select: { id: true },
              });
              if (existing) {
                newInterpreter = existing;
              } else {
                // Edge case: externalId collision with timestamp suffix as last resort
                newInterpreter = await prisma.interpreter.create({
                  data: {
                    externalId: `auth-${profile.id}-${Date.now()}`,
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
              where: { id: profile.id },
              data: { interpreterId: newInterpreter.id },
            });
            profile = { ...profile, interpreterId: newInterpreter.id, interpreter: null };
            console.log(`🔧 [AUTH] Interpreter auto-created and linked in getCurrentProfile for ${profile.id} → interpreter ${newInterpreter.id}`);
          }
        } else {
          console.warn(`⚠️ [AUTH] Admin user ${profile.id} has no interpreterId — expected, skipping auto-create`);
        }
      } catch (linkErr) {
        console.error('[AUTH] Interpreter link repair in getCurrentProfile failed:', linkErr);
      }
    }

    return {
      id: profile.id,
      email: profile.email,
      role: profile.role as UserRole,
      interpreter_id: profile.interpreterId,
      display_name: profile.displayName || '',
      terms_accepted_at: profile.termsAcceptedAt?.toISOString() || null,
      signature_date: profile.signatureDate?.toISOString() || null,
      bank_name: profile.bankName,
      bank_account: profile.bankAccount,
      bank_account_type: profile.bankAccountType,
      bank_cedula: profile.bankCedula,
      onboarding_complete: profile.onboardingComplete || false,
      created_at: profile.createdAt?.toISOString() || new Date().toISOString(),
    };
  } catch (error: unknown) {
    if (isSupabaseConfigError(error)) {
      console.warn('⚠️ [AUTH] Profile fetch omitido por falta de configuración.');
      return null;
    }
    console.error('🔴 [AUTH] Profile fetch failed:', error);
    return null;
  }
}

export async function logout() {
  // Clear the role cookie
  const cookieStore = await cookies();
  cookieStore.delete('user-role');

  // Sign out of NextAuth if a session exists
  try {
    const { signOut: nextAuthSignOut } = await import('@/lib/auth-rbac');
    await nextAuthSignOut({ redirect: false });
  } catch (_) {
    // Ignore — may not have a NextAuth session
  }

  // Sign out of Supabase
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}

export async function requestPasswordReset(formData: FormData) {
  const email = ((formData.get('email') as string) || '').toLowerCase().trim();
  if (!email) return { success: false, error: 'Email is required' };

  try {
    const headersList = await (await import('next/headers')).headers();
    const host = headersList.get('x-forwarded-host') || headersList.get('host');
    const proto = headersList.get('x-forwarded-proto') || 'https';
    const origin = host ? `${proto}://${host}` : '';

    const { supabaseAdmin } = await import('@/lib/supabase/admin');

    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: {
        redirectTo: `${origin}/auth/callback?next=/reset-password`,
      },
    });

    if (error) {
      console.error('🔴 [AUTH_RESET] Error generating link:', error.message);
      return { success: false, error: error.message };
    }

    console.log('\n======================================================');
    console.log('🔐 [ZERO-COST RECOVERY] PASSWORD RESET LINK GENERATED');
    console.log(`👤 User: ${email}`);
    console.log(`🔗 Link: ${data.properties?.action_link}`);
    console.log('======================================================\n');

    return { success: true };
  } catch (err: unknown) {
    const { isAdminUnavailableError } = await import('@/lib/supabase/admin');
    if (
      isAdminUnavailableError(err) ||
      (err instanceof Error &&
        (err.message.includes('SUPABASE_SERVICE_ROLE_KEY') || err.message.includes('NEXT_PUBLIC_SUPABASE_URL')))
    ) {
      console.warn('⚠️ [AUTH_RESET] Request password omitido por falta de configuración.');
      return { success: false, error: 'Servicio deshabilitado temporalmente.' };
    }
    console.error('🔴 [AUTH_RESET] Unexpected error:', err);
    return { success: false, error: 'Error al solicitar el reset de contraseña.' };
  }
}

export async function updatePassword(formData: FormData) {
  const password = formData.get('password') as string;
  const confirmPassword = formData.get('confirmPassword') as string;

  if (!password || password !== confirmPassword) {
    return { success: false, error: 'Las contraseñas no coinciden o están vacías.' };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.updateUser({ password });
    if (error) return { success: false, error: error.message };

    if (data.user?.email) {
      try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await (prisma as any).rbacUser.update({
          where: { email: data.user.email.toLowerCase().trim() },
          data: { password: hashedPassword },
        });
      } catch (rbacSyncErr) {
        console.warn('⚠️ [AUTH_UPDATE_PASSWORD] rbac_users sync skipped:', rbacSyncErr);
      }
    }

    return { success: true };
  } catch (err: unknown) {
    if (isSupabaseConfigError(err)) {
      return { success: false, error: 'Servicio deshabilitado temporalmente.' };
    }
    return { success: false, error: 'Error al actualizar la contraseña.' };
  }
}
