'use server';

import { revalidatePath } from 'next/cache';
import { revalidateInterpreterProfileRecords } from '@/lib/cache/revalidate-interpreter';
import prisma from '@/lib/prisma';
import { InterpreterSchema, InterpreterInput } from '@/lib/validators';
import { ActionResult } from '@/lib/types';
import { supabaseAdmin, isAdminUnavailableError, getSupabaseServiceRoleKey, ADMIN_UNAVAILABLE_MESSAGE } from '@/lib/supabase/admin';
import { upsertConfirmedAuthUser } from '@/lib/supabase/auth-users';
import { Interpreter, Prisma } from '@prisma/client';
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

  try {
    const validated = InterpreterSchema.parse(data);
    const { password, ...interpreterData } = validated;

    const result = await db.$transaction(async (tx) => {
      // 1. Create interpreter record
      const interpreter = await tx.interpreter.create({
        data: interpreterData,
        select: { id: true, name: true, emailCorporativo: true }
      });

      // 2. If password provided, create Auth user and UserProfile
      if (password) {
        if (!interpreter.emailCorporativo) {
          throw new Error('Email corporativo is required for account creation');
        }

        const authUser = await createInterpreterAuthUser(
          interpreter.emailCorporativo,
          password,
          interpreter.name
        );

        if (!authUser) {
          throw new Error('No se pudo crear el usuario de autenticación.');
        }

        await tx.userProfile.upsert({
          where: { id: authUser.id },
          update: {
            email: interpreter.emailCorporativo,
            displayName: interpreter.name,
            interpreterId: interpreter.id,
            onboardingComplete: true
          },
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

      return { id: interpreter.id, name: interpreter.name };
    });

    revalidateInterpreterProfileRecords(result.id);
    return { success: true, data: result };
  } catch (error: unknown) {
    console.error('🔴 ERROR [createInterpreter]:', error);

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { success: false, error: 'Un intérprete con este ID externo o Email ya existe.', code: 'CONFLICT' };
    }
    const errorMsg = error instanceof Error ? error.message : 'Error al crear el intérprete';
    if (isAdminUnavailableError(error) || errorMsg === ADMIN_UNAVAILABLE_MESSAGE) {
      return { success: false, error: ADMIN_UNAVAILABLE_MESSAGE, code: 'SERVICE_UNAVAILABLE' };
    }
    return { success: false, error: errorMsg, code: 'INTERNAL_ERROR' };
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
