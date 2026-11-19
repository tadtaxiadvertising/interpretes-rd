'use server';

import { revalidatePath } from 'next/cache';
import { revalidateInterpreterProfileRecords } from '@/lib/cache/revalidate-interpreter';
import prisma from '@/lib/prisma';
import { InterpreterSchema, InterpreterInput } from '@/lib/validators';
import { ActionResult } from '@/lib/types';
import { supabaseAdmin, isAdminUnavailableError, getSupabaseServiceRoleKey, ADMIN_UNAVAILABLE_MESSAGE } from '@/lib/supabase/admin';
import { findAuthUserByEmail, upsertConfirmedAuthUser } from '@/lib/supabase/auth-users';
import { Interpreter, Prisma } from '@prisma/client';
import { z } from 'zod';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';
import { validateAction } from '@/lib/auth/actions';
import { UpdateInterpreterStatusSchema } from '@/lib/validators/interpreters';
import { deleteInterpreterDatabaseRecords } from '@/lib/interpreters/delete-interpreter';

const db = prisma;

async function createInterpreterAuthUser(email: string, password: string, displayName: string) {
  try {
    return await upsertConfirmedAuthUser({
      email,
      password,
      displayName,
    });
  } catch (error) {
    if (isAdminUnavailableError(error)) {
      throw new Error(ADMIN_UNAVAILABLE_MESSAGE);
    }
    throw error;
  }
}

/**
 * ACTION: Create Interpreter
 */
export async function createInterpreter(data: InterpreterInput): Promise<ActionResult<{ id: number; name: string }>> {
  const auth = await validateAction('admin');
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  // The Auth provider can commit outside Prisma's transaction. If anything
  // fails after provisioning starts, the administrator must verify both
  // systems before trying again; never infer a safe automatic retry.
  let authProvisioningStarted = false;
  try {
    const validated = InterpreterSchema.parse(data);
    const { password, ...interpreterData } = validated;
    const email = interpreterData.emailCorporativo?.trim().toLowerCase() ?? null;

    if (password && !email) {
      return { success: false, code: 'VALIDATION_ERROR',
        error: 'Se requiere correo corporativo para crear una cuenta con contraseña.' };
    }

    // This Server Action is used by the administrator's actual form.
    // Reject a known local account BEFORE attempting any external Auth work.
    // The unique indexes remain authoritative for exact-key races; this
    // read-only check alone is not a distributed idempotency guarantee.
    const existingInterpreter = await db.interpreter.findFirst({
      where: {
        OR: [
          { externalId: { equals: interpreterData.externalId, mode: 'insensitive' } },
          ...(email ? [{ emailCorporativo: { equals: email, mode: 'insensitive' as const } }] : []),
        ],
      },
      select: { id: true },
    });
    if (existingInterpreter) {
      return { success: false, code: 'CONFLICT',
        error: 'Ya existe un intérprete con ese identificador o correo. Revisa el registro antes de repetir el alta.' };
    }

    if (password && email) {
      // A matching legacy RBAC email signals possible cross-provider access,
      // NOT proof that both accounts belong to the same person.
      // Never merge, reset or delete an identity by an email match.
      try {
        const legacyIdentity = await db.rbacUser.findFirst({
          where: { email: { equals: email, mode: 'insensitive' } },
          select: { id: true },
        });
        if (legacyIdentity) {
          return { success: false, code: 'CONFLICT',
            error: 'Existe un acceso heredado que requiere revisión de identidad antes de crear la cuenta.' };
        }
      } catch (legacyError) {
        console.warn('[CREATE_INTERPRETER] Legacy identity preflight failed:', safeServerErrorCategory(legacyError));
        return { success: false, code: 'SERVICE_UNAVAILABLE',
          error: 'No se pudo verificar el acceso heredado. No se creó ninguna cuenta.' };
      }

      // Probe the same directory as the API route, without creating or
      // modifying a Supabase Auth user. A failed lookup must fail closed.
      try {
        void supabaseAdmin.auth;
        const existingAuth = await findAuthUserByEmail(supabaseAdmin, email);
        if (existingAuth) {
          return { success: false, code: 'CONFLICT',
            error: 'Ese correo ya tiene una cuenta de autenticación. Revisa su identidad antes de continuar.' };
        }
      } catch (providerError) {
        console.warn('[CREATE_INTERPRETER] Auth identity preflight failed:', safeServerErrorCategory(providerError));
        return { success: false, code: 'SERVICE_UNAVAILABLE',
          error: 'No se pudo verificar el directorio de autenticación. No se creó ninguna cuenta.' };
      }
    }

    const result = await db.$transaction(async (tx) => {
      const interpreter = await tx.interpreter.create({
        data: interpreterData,
        select: { id: true, name: true, emailCorporativo: true },
      });

      if (password) {
        if (!interpreter.emailCorporativo) {
          throw new Error('Missing corporate email for provisioned interpreter');
        }

        // This external call is not rolled back if a later Prisma operation
        // fails; the result is deliberately flagged for manual reconciliation.
        authProvisioningStarted = true;
        const authUser = await createInterpreterAuthUser(
          interpreter.emailCorporativo,
          password,
          interpreter.name,
        );
        if (!authUser) {
          throw new Error('Auth provider returned no identity');
        }

        await tx.userProfile.upsert({
          where: { id: authUser.id },
          update: {
            email: interpreter.emailCorporativo,
            displayName: interpreter.name,
            interpreterId: interpreter.id,
            onboardingComplete: true,
          },
          create: {
            id: authUser.id,
            email: interpreter.emailCorporativo,
            displayName: interpreter.name,
            role: 'interpreter',
            interpreterId: interpreter.id,
            onboardingComplete: true,
          },
        });
      }
      return { id: interpreter.id, name: interpreter.name };
    });

    revalidateInterpreterProfileRecords(result.id);
    return { success: true, data: result };
  } catch (error: unknown) {
    // Neither provider messages nor error objects can be returned/logged:
    // they may include credentials, signed links or database connection URLs.
    console.error('[CREATE_INTERPRETER] Failed:', safeServerErrorCategory(error));
    if (error instanceof z.ZodError) {
      return { success: false, code: 'VALIDATION_ERROR',
        error: 'Los datos del intérprete no son válidos.' };
    }
    if (authProvisioningStarted) {
      return { success: false, code: 'INTERNAL_ERROR',
        error: 'No se pudo confirmar el alta. La cuenta de autenticación podría existir. Revisa su estado antes de reintentar.' };
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { success: false, code: 'CONFLICT',
        error: 'Un intérprete con ese identificador o correo ya existe.' };
    }
    if (isAdminUnavailableError(error)) {
      return { success: false, code: 'SERVICE_UNAVAILABLE',
        error: 'El servicio de autenticación no está disponible. No se confirmó el alta.' };
    }
    return { success: false, code: 'INTERNAL_ERROR',
      error: 'No se pudo crear el intérprete. Verifica el estado antes de reintentar.' };
  }
}

/**
 * ACTION: Update Interpreter
 */
export async function updateInterpreter(id: number, data: Partial<InterpreterInput>): Promise<ActionResult<{ id: number; name: string }>> {
  const auth = await validateAction('admin');
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  try {
    const validated = InterpreterSchema.partial().parse(data);
    const { password, ...updateData } = validated;

    const interpreter = await db.interpreter.update({
      where: { id },
      data: updateData,
      select: { id: true, name: true, emailCorporativo: true }
    });

    await db.userProfile.updateMany({
      where: { interpreterId: id },
      data: {
        displayName: interpreter.name,
        ...(interpreter.emailCorporativo ? { email: interpreter.emailCorporativo } : {}),
      },
    });

    revalidateInterpreterProfileRecords(id);
    return { success: true, data: interpreter };
  } catch (error: unknown) {
    console.error('🔴 ERROR [updateInterpreter]:', error);
    return { success: false, error: 'Error al actualizar el intérprete', code: 'INTERNAL_ERROR' };
  }
}

/**
 * ACTION: Delete Interpreter (with Auth User)
 */
export async function deleteInterpreter(id: number): Promise<ActionResult> {
  const auth = await validateAction('admin');
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  try {
    // 1. Validar cliente de Supabase Admin access
    try {
      void supabaseAdmin.auth;
    } catch (err) {
      if (isAdminUnavailableError(err)) {
        return {
          success: false,
          error: ADMIN_UNAVAILABLE_MESSAGE,
          code: 'SERVICE_UNAVAILABLE'
        };
      }
      throw err;
    }

    // 2. Perform DB deletion
    const { authUserId } = await db.$transaction((tx: any) => deleteInterpreterDatabaseRecords(tx, id));

    // 3. Delete Supabase Auth user if client is ready and user is linked
    if (authUserId) {
      const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(authUserId);
      if (authError) console.warn('⚠️ Fallo al borrar usuario de Auth:', authError.message);
    }

    revalidateInterpreterProfileRecords(id);
    return { success: true };
  } catch (error: unknown) {
    console.error('🔴 ERROR [deleteInterpreter]:', error);

    const errorMsg = error instanceof Error ? error.message : 'Error desconocido';
    if (errorMsg === 'Intérprete no encontrado') {
      return { success: false, error: 'El intérprete no se encuentra o ya fue eliminado.', code: 'NOT_FOUND' };
    }

    return { success: false, error: errorMsg || 'Error al eliminar el intérprete', code: 'INTERNAL_ERROR' };
  }
}

/**
 * ACTION: Reset/Set Interpreter Password
 */
export async function getInterpretersForSelect(): Promise<ActionResult<{ id: number; name: string; externalId: string }[]>> {
  // The full interpreter roster is administrative data; authenticated
  // interpreters and candidates must not enumerate the operational directory.
  const auth = await validateAction('admin');
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  try {
    const interpreters = await db.interpreter.findMany({
      select: {
        id: true,
        name: true,
        externalId: true,
      },
      orderBy: {
        name: "asc",
      },
    });

    return { success: true, data: interpreters };
  } catch (error: unknown) {
    console.error('🔴 ERROR [getInterpretersForSelect]:', error);
    return { success: false, error: 'Error al obtener intérpretes', code: 'INTERNAL_ERROR' };
  }
}

/**
 * ACTION: Reset/Set Interpreter Password
 */
export async function resetInterpreterPassword(id: number, password: string): Promise<ActionResult> {
  const auth = await validateAction('admin');
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  try {
    const interpreter = await db.interpreter.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        emailCorporativo: true,
        userProfile: { select: { id: true } }
      }
    });

    if (!interpreter) return { success: false, error: 'Intérprete no encontrado', code: 'NOT_FOUND' };

    let userProfileId = interpreter.userProfile?.id;

    try {
      void supabaseAdmin.auth;
    } catch (err) {
      if (isAdminUnavailableError(err) && !userProfileId) {
        return { success: false, error: ADMIN_UNAVAILABLE_MESSAGE, code: 'SERVICE_UNAVAILABLE' };
      }
    }

    if (!userProfileId) {
      if (!interpreter.emailCorporativo) {
        return { success: false, error: 'No hay cuenta vinculada ni email corporativo configurado.', code: 'VALIDATION_ERROR' };
      }

      const authUser = await upsertConfirmedAuthUser({
        email: interpreter.emailCorporativo,
        password,
        displayName: interpreter.name,
      });

      // 2. Link Profile
      if (authUser) {
        await db.userProfile.upsert({
          where: { id: authUser.id },
          update: { interpreterId: interpreter.id, onboardingComplete: true },
          create: {
            id: authUser.id,
            email: interpreter.emailCorporativo,
            displayName: interpreter.name,
            role: 'interpreter',
            interpreterId: interpreter.id,
            onboardingComplete: true
          }
        });
      }
    } else {
      try {
        const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(userProfileId, {
          password,
          email_confirm: true,
        });
        if (authError) throw authError;
      } catch (authErr) {
        if (isAdminUnavailableError(authErr)) {
          return { success: false, error: ADMIN_UNAVAILABLE_MESSAGE, code: 'SERVICE_UNAVAILABLE' };
        }
        throw authErr;
      }
    }

    revalidateInterpreterProfileRecords(id);
    return { success: true };
  } catch (error: unknown) {
    console.error('🔴 ERROR [resetInterpreterPassword]:', error);
    return { success: false, error: 'Error al resetear contraseña', code: 'INTERNAL_ERROR' };
  }
}

/**
 * ACTION: Toggle Realtime Status
 */
export async function updateRealtimeStatus(id: number, status: 'Online' | 'Offline' | 'Busy'): Promise<ActionResult> {
  const auth = await validateAction(['admin', 'interpreter']);
  if ('error' in auth) return { success: false, error: auth.error, code: auth.code };

  try {
    // If user is interpreter, they can only update their own status
    if (auth.profile.role === 'interpreter' && auth.profile.interpreterId !== id) {
      return { success: false, error: 'Acceso denegado', code: 'UNAUTHORIZED' };
    }

    await db.interpreter.update({
      where: { id },
      data: { realtimeStatus: status },
      select: { id: true }
    });

    revalidateInterpreterProfileRecords(id);
    return { success: true };
  } catch (error: unknown) {
    console.error('🔴 ERROR [updateRealtimeStatus]:', error);
    return { success: false, error: 'Error al actualizar estado realtime', code: 'INTERNAL_ERROR' };
  }
}

export async function updateInterpreterStatusAction(data: unknown): Promise<{ success: boolean; data?: { id: number; status: string }; error?: string }> {
  const auth = await validateAction('admin');
  if ('error' in auth) return { success: false, error: auth.error };

  try {
    const parsedData = UpdateInterpreterStatusSchema.strict().parse(data);

    const updatedInterpreter = await db.interpreter.update({
      where: { id: parsedData.id },
      data: { status: parsedData.status },
      select: { id: true, status: true },
    });

    revalidatePath('/admin/roster');
    revalidatePath('/interpreters');
    revalidateInterpreterProfileRecords(parsedData.id);

    const normalizedInterpreter = {
      id: updatedInterpreter.id,
      status: updatedInterpreter.status ?? 'Activo',
    };

    return {
      success: true,
      data: normalizedInterpreter,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'No se pudo actualizar el estado del intérprete';
    return { success: false, error: message };
  }
}
