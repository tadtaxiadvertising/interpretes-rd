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
import { getCurrentActor } from '@/lib/auth/current-actor';

const prisma = prismaClient;

const AuthSchema = z.object({
  email: z.string().email().transform(val => val.toLowerCase().trim()),
  password: z.string().min(6),
  role: z.enum(['admin', 'interpreter']).default('interpreter'),
});

function normalizeRbacRole(role: string | null | undefined): UserRole {
  return role?.toLowerCase() === 'admin' ? 'admin' : 'interpreter';
}

// Repair cooldown to prevent infinite loops (5 minutes)
const repairCooldown = new Map<string, number>();
const REPAIR_COOLDOWN_MS = 5 * 60 * 1000;

function canAttemptRepair(email: string): boolean {
  const lastAttempt = repairCooldown.get(email);
  if (!lastAttempt) return true;
  if (Date.now() - lastAttempt > REPAIR_COOLDOWN_MS) {
    repairCooldown.delete(email);
    return true;
  }
  return false;
}

function recordRepairAttempt(email: string) {
  repairCooldown.set(email, Date.now());
}

async function syncUserProfileFromAuth(params: {
  userId: string;
  email: string;
  role: UserRole;
  displayName: string;
}) {
  const resolvedRole = resolveUserRoleByEmail(params.email, params.role);

  const interpreter = resolvedRole === 'admin' ? null : await prisma.interpreter.findFirst({
    // Link to an interpreter only by the authoritative corporate email.
    // A matching display name is not proof of identity and can expose another
    // interpreter's profile or production data when names are similar.
    where: { emailCorporativo: params.email },
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

/**
 * ACTION: User Login
 */
export async function login(formData: FormData) {
  const email = ((formData.get('email') as string) || '').toLowerCase().trim();
  const password = (formData.get('password') as string) || '';
  const requestedRole = ((formData.get('role') as string) || 'interpreter').toLowerCase() as UserRole;
  // The selected portal is untrusted client input. Supabase users get admin
  // privileges only from the protected identity allowlist or an existing
  // trusted profile; selecting "admin" in the form never elevates a new account.
  const effectiveRequestedRole = resolveUserRoleByEmail(email, 'interpreter');

  try {
    const validated = AuthSchema.parse({ email, password, role: effectiveRequestedRole });
    const supabase = await createClient();

    const { data, error } = await supabase.auth.signInWithPassword({
      email: validated.email,
      password: validated.password,
    });

    if (error) {
      console.error(`🔴 [AUTH_LOGIN] Failed for ${email}:`, error.message);

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
      // The local RBAC database role is authoritative only after its password
      // has been verified. Compare the requested portal to that role, never use
      // the portal selection to calculate or grant the role itself.
      if (requestedRole !== localRole) {
        return {
          success: false,
          error: 'Estas credenciales no corresponden al portal seleccionado.',
        };
      }

      // Try to repair an existing Supabase Auth user (login still works via NextAuth).
      // If the user doesn't exist yet in Supabase Auth, skip provisioning —
      // the client falls through to NextAuth credentials provider instead.
      // This prevents unauthorized account creation from local-only credentials.
      if (getSupabaseServiceRoleKey() && canAttemptRepair(email)) {
        try {
          recordRepairAttempt(email);
          const oldProfile = await prisma.userProfile.findFirst({
            where: { email },
            select: { id: true, interpreterId: true },
          });

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
              if (oldProfile && oldProfile.id !== retry.data.user.id) {
                // Never delete or duplicate an application profile if an Auth UUID changes unexpectedly.
                console.error('[AUTH_LOGIN] Supabase user ID differs from the existing profile ID; profile preserved for manual reconciliation.');
              } else {
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

    // Reject duplicates in application tables before any Auth admin operation.
    // Registration is not a password-reset mechanism and must not take over legacy RBAC accounts.
    const [existingProfile, existingRbacUser] = await Promise.all([
      prisma.userProfile.findUnique({
        where: { email: validated.email },
        select: { id: true },
      }),
      prisma.rbacUser.findUnique({
        where: { email: validated.email },
        select: { id: true },
      }),
    ]);

    if (existingProfile || existingRbacUser) {
      return {
        success: false,
        error: 'Ya existe una cuenta con este correo. Inicia sesión o utiliza la recuperación de contraseña.',
      };
    }

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
      // Do not associate a registration with an interpreter by name alone.
      where: { emailCorporativo: validated.email },
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
      await (prisma as any).rbacUser.create({
        data: {
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
 * Uses CurrentActor abstraction — NO auto-provisioning, NO silent repairs.
 * Returns null if profile doesn't exist (caller must handle).
 */
export async function getCurrentProfile(): Promise<UserProfile | null> {
  try {
    const actor = await getCurrentActor();
    if (!actor || !actor.profileId) return null;

    let profile = await prisma.userProfile.findUnique({
      where: { id: actor.profileId },
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

    if (!profile) return null;

    let resolvedRole = resolveUserRoleByEmail(profile.email, profile.role);
    if (profile.role !== resolvedRole) {
      await prisma.userProfile.update({
        where: { id: profile.id },
        data: { role: resolvedRole, interpreterId: resolvedRole === 'admin' ? null : undefined },
      });
      profile = { ...profile, role: resolvedRole, interpreterId: resolvedRole === 'admin' ? null : profile.interpreterId, interpreter: resolvedRole === 'admin' ? null : profile.interpreter };
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
    // Use a configured origin only. Do not construct password-recovery URLs
    // from Host / X-Forwarded-Host headers, which can be attacker-controlled.
    const configuredOrigin =
      process.env.NEXT_PUBLIC_SITE_URL ||
      process.env.FRONTEND_ORIGIN ||
      (process.env.NODE_ENV === 'production'
        ? 'https://interpretes.rd.ibusiness.com.do'
        : 'http://localhost:3001');
    const siteOrigin = new URL(configuredOrigin).origin;
    const redirectTo = new URL('/auth/callback?next=/reset-password', siteOrigin).toString();

    // This sends the reset email through Supabase Auth. Never generate a
    // recovery token solely for server logs: action links grant account access.
    const supabase = await createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });

    if (error) {
      // Do not log the address or any token. Avoid leaking account existence.
      console.error('[AUTH_RESET] Password reset request failed:', error.name || 'AuthError');
      return {
        success: false,
        error: 'No se pudo enviar el enlace de recuperación. Inténtalo más tarde.',
      };
    }

    return { success: true };
  } catch (err: unknown) {
    if (isSupabaseConfigError(err)) {
      return { success: false, error: 'Servicio deshabilitado temporalmente.' };
    }
    console.error(
      '[AUTH_RESET] Unexpected recovery error:',
      err instanceof Error ? err.name : 'UnknownError'
    );
    return {
      success: false,
      error: 'No se pudo enviar el enlace de recuperación. Inténtalo más tarde.',
    };
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
