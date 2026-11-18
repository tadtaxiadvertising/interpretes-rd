'use server';

import prismaClient from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { UserRole } from '@/lib/types';
import { supabaseAdmin, isAdminUnavailableError, ADMIN_UNAVAILABLE_MESSAGE } from '@/lib/supabase/admin';
import { revalidateInterpreterProfileRecords } from '@/lib/cache/revalidate-interpreter';
import { resolveUserRoleByEmail, isProtectedAdminEmail, normalizeEmail } from '@/lib/admin-identity';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';

const prisma = prismaClient;

export async function getAdminUsers() {
  const { user } = await auth();
  if (!user || user.role !== 'admin') {
    throw new Error('Unauthorized');
  }

  return prisma.userProfile.findMany({
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      interpreterId: true,
      onboardingComplete: true,
      createdAt: true,
      interpreter: { select: { id: true, name: true, campaign: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function updateUserRole(userId: string, role: UserRole) {
  const { user } = await auth();
  if (!user || user.role !== 'admin') {
    throw new Error('Unauthorized');
  }

  // TypeScript unions do not validate direct server-action calls at runtime.
  const validRoles: readonly string[] = ['admin', 'candidate', 'interpreter'];
  if (!validRoles.includes(role)) {
    return { success: false, error: 'El rol seleccionado no está disponible.' };
  }

  const existing = await prisma.userProfile.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  if (!existing) return { success: false, error: 'El usuario ya no existe.' };
  if (isProtectedAdminEmail(existing.email) && role !== 'admin') {
    return { success: false, error: 'El administrador protegido no puede perder su rol.' };
  }

  const updated = await prisma.userProfile.update({
    where: { id: userId },
    data: { role },
    select: { interpreterId: true },
  });

  // The role mutation is already committed. Do not request a second role
  // change when only the cached roster cannot be refreshed.
  try {
    revalidateInterpreterProfileRecords(updated.interpreterId);
  } catch (error) {
    console.warn('[ADMIN_USERS] Role saved but cache refresh failed:', safeServerErrorCategory(error));
  }
  return { success: true };
}

export async function linkUserToInterpreter(userId: string, interpreterId: number | null) {
  const { user } = await auth();
  if (!user || user.role !== 'admin') {
    throw new Error('Unauthorized');
  }

  // Server actions can receive untyped values despite the TypeScript signature.
  if (interpreterId !== null && (!Number.isSafeInteger(interpreterId) || interpreterId <= 0)) {
    return { success: false, error: 'El identificador del intérprete no es válido.' };
  }

  const previous = await prisma.userProfile.findUnique({
    where: { id: userId },
    select: { interpreterId: true, email: true, role: true },
  });
  if (!previous) {
    return { success: false, error: 'El usuario ya no existe.' };
  }

  // Admin identities must not acquire interpreter-linked data or be
  // inadvertently reclassified by the management UI.
  if (previous.role === 'admin' || isProtectedAdminEmail(previous.email)) {
    return { success: false, error: 'No se puede vincular una cuenta administrativa a un intérprete.' };
  }

  if (interpreterId !== null) {
    const interpreter = await prisma.interpreter.findUnique({
      where: { id: interpreterId },
      select: { id: true },
    });
    if (!interpreter) {
      return { success: false, error: 'El intérprete seleccionado ya no existe.' };
    }
  }

  try {
    await prisma.userProfile.update({
      where: { id: userId },
      data: { interpreterId },
      select: { interpreterId: true },
    });
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: unknown }).code : null;
    if (code === 'P2002') {
      return { success: false, error: 'El intérprete ya está vinculado a otra cuenta.' };
    }
    if (code === 'P2025') {
      return { success: false, error: 'La cuenta o el intérprete ya no existe.' };
    }
    console.error('[ADMIN_USERS] Interpreter link update failed:', safeServerErrorCategory(error));
    return { success: false, error: 'No se pudo actualizar el vínculo del intérprete.' };
  }

  // Both views may need invalidation; a cache failure is not a failed write.
  const ids = new Set([previous.interpreterId, interpreterId]);
  for (const id of ids) {
    try {
      revalidateInterpreterProfileRecords(id);
    } catch (error) {
      console.warn('[ADMIN_USERS] Interpreter link saved but cache refresh failed:', safeServerErrorCategory(error));
    }
  }
  return { success: true };
}

export async function updateUserPassword(userId: string, newPassword: string) {
  try {
    const { user } = await auth();
    if (!user || user.role !== 'admin') {
      throw new Error('Unauthorized');
    }

    try {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        password: newPassword,
        email_confirm: true,
      });

      if (error) {
        console.error('[ADMIN_USERS] Password update rejected:', safeServerErrorCategory(error));
        return { success: false, error: 'No se pudo actualizar la contraseña.' };
      }
    } catch (adminError) {
      if (isAdminUnavailableError(adminError)) {
        return { success: false, error: ADMIN_UNAVAILABLE_MESSAGE };
      }
      throw adminError;
    }

    return { success: true };
  } catch (error: any) {
    console.error('[ADMIN_USERS] Password update failed:', safeServerErrorCategory(error));
    return { success: false, error: 'No se pudo actualizar la contraseña.' };
  }
}

export async function updateUserProfile(userId: string, data: { displayName: string; email: string }) {
  try {
    const { user } = await auth();
    if (!user || user.role !== 'admin') {
      return { success: false, error: 'Acceso no autorizado.' };
    }

    // Only expose fields needed by the caller, never an entire profile record.
    const updated = await prisma.userProfile.update({
      where: { id: userId },
      data: {
        displayName: data.displayName,
        email: data.email,
      },
      select: { interpreterId: true, displayName: true, email: true },
    });

    // Supabase and PostgreSQL are independent systems. Once the local write
    // commits, a failed provider sync must be an explicit PARTIAL outcome.
    let providerSynced = false;
    try {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        email: data.email,
        email_confirm: true,
        user_metadata: { display_name: data.displayName },
      });
      if (error) {
        console.warn('[ADMIN_USERS] Profile sync rejected:', safeServerErrorCategory(error));
      } else {
        providerSynced = true;
      }
    } catch (supabaseError) {
      console.warn(
        '[ADMIN_USERS] Profile sync unavailable:',
        isAdminUnavailableError(supabaseError) ? 'AdminUnavailable' : safeServerErrorCategory(supabaseError),
      );
    }

    // Local write has committed regardless of the provider outcome.
    // Failure to invalidate a page must not ask the operator to repeat it.
    try {
      revalidateInterpreterProfileRecords(updated.interpreterId);
    } catch (cacheError) {
      console.warn('[ADMIN_USERS] Profile saved but cache refresh failed:', safeServerErrorCategory(cacheError));
    }

    if (!providerSynced) {
      return {
        success: false,
        partial: true,
        error: 'Perfil local actualizado, pero la sincronización con Supabase Auth quedó pendiente. Revisa el estado antes de volver a intentarlo.',
      };
    }
    return { success: true, profile: updated };
  } catch (error) {
    console.error('[ADMIN_USERS] Profile update failed:', safeServerErrorCategory(error));
    return { success: false, error: 'Error al actualizar el perfil.' };
  }
}

export async function deleteUserAccess(userId: string) {
  try {
    const { user, userId: currentUserId } = await auth();
    if (!user || user.role !== 'admin') {
      return { success: false, error: 'Acceso no autorizado.' };
    }

    // Fail closed BEFORE calling the external, destructive Auth API. The
    // protected administrator and the current actor may never self-revoke,
    // including through the legacy NextAuth bridge where user IDs differ.
    const target = await prisma.userProfile.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!target) {
      return { success: false, error: 'El perfil solicitado ya no existe. Verifica su estado antes de continuar.' };
    }
    if (isProtectedAdminEmail(target.email)) {
      return { success: false, error: 'No se puede revocar la cuenta administrativa protegida.' };
    }
    if (
      (currentUserId != null && currentUserId === userId) ||
      (typeof user.email === 'string' && normalizeEmail(user.email) === normalizeEmail(target.email))
    ) {
      return { success: false, error: 'No puedes revocar tu propio acceso administrativo.' };
    }

    // Revoke external authentication FIRST. Deleting the local profile first
    // would leave a still-authenticated Supabase user if the provider fails.
    try {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (error) {
        console.error('[ADMIN_USERS] Auth revocation rejected:', safeServerErrorCategory(error));
        return { success: false, error: 'No se pudo revocar el acceso de autenticación. No se modificó el perfil local.' };
      }
    } catch (adminError) {
      if (isAdminUnavailableError(adminError)) {
        return { success: false, error: ADMIN_UNAVAILABLE_MESSAGE };
      }
      console.error('[ADMIN_USERS] Auth revocation failed:', safeServerErrorCategory(adminError));
      return { success: false, error: 'No se pudo revocar el acceso de autenticación. No se modificó el perfil local.' };
    }

    // Auth has been revoked. If local cleanup fails, distinguish a PARTIAL
    // outcome so operators do not assume the provider account still exists.
    let interpreterId: number | null;
    try {
      const deleted = await prisma.userProfile.delete({
        where: { id: userId },
        select: { interpreterId: true },
      });
      interpreterId = deleted.interpreterId;
    } catch (error) {
      console.error('[ADMIN_USERS] Local cleanup after auth revocation failed:', safeServerErrorCategory(error));
      return {
        success: false,
        partial: true,
        error: 'Acceso de autenticación revocado; la limpieza del perfil local quedó pendiente de revisión.',
      };
    }

    // Local deletion already committed; cache failures must not produce a
    // false revocation failure and encourage a second destructive operation.
    try {
      revalidateInterpreterProfileRecords(interpreterId);
    } catch (error) {
      console.warn('[ADMIN_USERS] Access removed but cache refresh failed:', safeServerErrorCategory(error));
    }
    return { success: true };
  } catch (error) {
    console.error('[ADMIN_USERS] Access deletion failed:', safeServerErrorCategory(error));
    return { success: false, error: 'No se pudo eliminar el acceso.' };
  }
}

export async function getAllInterpretersList() {
  const { user } = await auth();
  if (!user || user.role !== 'admin') {
    throw new Error('Unauthorized');
  }

  return prisma.interpreter.findMany({
    select: {
      id: true,
      name: true,
      emailCorporativo: true,
      campaign: true
    },
    orderBy: {
      name: 'asc'
    }
  });
}

export async function syncAllSupabaseUsers() {
  let syncedCount = 0;
  try {
    const { user } = await auth();
    if (!user || user.role !== 'admin') {
      return { success: false, error: 'Acceso no autorizado.' };
    }

    // Read the COMPLETE provider directory before modifying PostgreSQL. A
    // provider error on page 2 must not leave a half-imported roster.
    const pageSize = 100;
    const maxPages = 100;
    const supabaseUsers: Array<{
      id: string;
      email?: string | null;
      user_metadata?: { display_name?: unknown } | null;
    }> = [];
    const seenIds = new Set<string>();
    let page = 1;
    let fullyFetched = false;

    for (let request = 0; request < maxPages; request++) {
      let data;
      try {
        const response = await supabaseAdmin.auth.admin.listUsers({
          page,
          perPage: pageSize,
        });
        if (response.error) {
          console.error('[ADMIN_USERS] Supabase directory page rejected:', safeServerErrorCategory(response.error));
          return { success: false, error: 'No se pudo consultar el directorio completo de autenticación.' };
        }
        data = response.data;
      } catch (providerError) {
        if (isAdminUnavailableError(providerError)) {
          return { success: false, error: ADMIN_UNAVAILABLE_MESSAGE };
        }
        console.error('[ADMIN_USERS] Supabase directory page failed:', safeServerErrorCategory(providerError));
        return { success: false, error: 'No se pudo consultar el directorio completo de autenticación.' };
      }

      if (!data || !Array.isArray(data.users) || data.users.length > pageSize) {
        return { success: false, error: 'Supabase devolvió una respuesta de usuarios incompleta.' };
      }

      for (const entry of data.users) {
        if (!entry || typeof entry.id !== 'string' || !entry.id || seenIds.has(entry.id)) {
          // Repeated pages or missing IDs must never produce a falsely
          // completed synchronization or an unsafe local reassignment.
          return { success: false, error: 'La paginación de usuarios es inconsistente. No se modificaron perfiles.' };
        }
        seenIds.add(entry.id);
        supabaseUsers.push(entry);
      }

      // Supabase GoTrue exposes nextPage on paginated responses. Also support
      // SDK versions that only return the page items.
      const nextPage = (data as { nextPage?: number | null }).nextPage;
      if (nextPage !== undefined) {
        if (nextPage === null) {
          fullyFetched = true;
          break;
        }
        if (!Number.isSafeInteger(nextPage) || nextPage <= page || nextPage > maxPages) {
          return { success: false, error: 'La paginación de usuarios no es válida. No se modificaron perfiles.' };
        }
        page = nextPage;
      } else if (data.users.length < pageSize) {
        fullyFetched = true;
        break;
      } else {
        page++;
      }
    }
    if (!fullyFetched) {
      return { success: false, error: 'El directorio excede el límite seguro de sincronización. No se modificaron perfiles.' };
    }

    for (const sUser of supabaseUsers) {
      if (!sUser.email) continue;

      const existing = await prisma.userProfile.findUnique({
        where: { id: sUser.id },
        select: { id: true, role: true, interpreterId: true },
      });
      const role = resolveUserRoleByEmail(sUser.email, existing?.role || 'interpreter');

      if (existing) {
        if (existing.role !== role || (role === 'admin' && existing.interpreterId !== null)) {
          await prisma.userProfile.update({
            where: { id: existing.id },
            data: { role, interpreterId: role === 'admin' ? null : undefined },
            select: { id: true },
          });
          syncedCount++;
        }
        continue;
      }

      const interpreter = await prisma.interpreter.findUnique({
        where: { emailCorporativo: sUser.email },
        select: { id: true },
      });
      await prisma.userProfile.create({
        data: {
          id: sUser.id,
          email: sUser.email,
          displayName:
            typeof sUser.user_metadata?.display_name === 'string' &&
            sUser.user_metadata.display_name.trim()
              ? sUser.user_metadata.display_name
              : sUser.email.split('@')[0],
          role,
          interpreterId: role === 'admin' ? null : (interpreter ? interpreter.id : null),
          // A provider account is NOT proof that onboarding was completed.
          onboardingComplete: false,
        },
        select: { id: true },
      });
      syncedCount++;
    }

    try {
      revalidatePath('/admin/users');
    } catch (cacheError) {
      console.warn('[ADMIN_USERS] User sync committed but cache refresh failed:', safeServerErrorCategory(cacheError));
    }
    return { success: true, syncedCount };
  } catch (error) {
    console.error('[ADMIN_USERS] User sync failed:', safeServerErrorCategory(error));
    if (syncedCount > 0) {
      // Already committed rows cannot be rolled back by a thrown error.
      try {
        revalidatePath('/admin/users');
      } catch (cacheError) {
        console.warn('[ADMIN_USERS] Partial sync cache refresh failed:', safeServerErrorCategory(cacheError));
      }
      return {
        success: false,
        partial: true,
        syncedCount,
        error: `Se actualizaron ${syncedCount} perfiles, pero la sincronización se interrumpió. Verifica el estado antes de repetirla.`,
      };
    }
    return { success: false, error: 'Error al sincronizar los usuarios.' };
  }
}
