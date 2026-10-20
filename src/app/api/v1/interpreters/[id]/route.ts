import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { guardApiAuth } from '@/lib/api-auth';
import { revalidateInterpreterProfileRecords } from '@/lib/cache/revalidate-interpreter';
import { deleteInterpreterDatabaseRecords } from '@/lib/interpreters/delete-interpreter';
import { InterpreterPatchSchema } from '@/lib/api-schemas';
import { apiError, numericIdParamSchema, parseJsonBody } from '@/lib/api-responses';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const denied = await guardApiAuth(request, 'admin');
    if (denied) return denied;

    const { id: interpreterId } = numericIdParamSchema.parse(await params);

    // Initialize Supabase admin client first, catching errors so missing environment
    // variables or configuration issues do not crash the entire deletion action.
    try {
      const { supabaseAdmin, isAdminUnavailableError } = await import('@/lib/supabase/admin');
      // Validate access to trigger error if missing role key
      void supabaseAdmin.auth;
    } catch (adminError: unknown) {
      console.warn(
        '⚠️ Fallo al inicializar el cliente de Supabase Admin:',
        adminError instanceof Error ? adminError.message : adminError
      );
    }

    const { authUserId } = await prisma.$transaction((tx: any) => deleteInterpreterDatabaseRecords(tx, interpreterId));

    if (authUserId) {
      try {
        const { supabaseAdmin } = await import('@/lib/supabase/admin');
        const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(authUserId);
        if (authError) console.warn('⚠️ Fallo al borrar usuario de Auth:', authError.message);
      } catch (err: unknown) {
        console.warn('⚠️ Fallo al borrar usuario de Auth:', err instanceof Error ? err.message : err);
      }
    }

    revalidateInterpreterProfileRecords(interpreterId);
    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Error deleting interpreter:', error);
    const message = error instanceof Error ? error.message : 'Error deleting interpreter';
    
    // Resolve gracefully if the interpreter is already deleted (e.g. from transaction desync)
    if (message === 'Intérprete no encontrado') {
      return NextResponse.json({ success: true });
    }
    
    return apiError({ error, fallback: 'Error deleting interpreter' });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const denied = await guardApiAuth(request, 'admin');
    if (denied) return denied;

    const { id: interpreterId } = numericIdParamSchema.parse(await params);
    const body = await parseJsonBody(request, InterpreterPatchSchema);
    const { password, ...updateData } = body;

    // 1. If password provided, update Supabase Auth
    if (password) {
      const interpreter = await prisma.interpreter.findUnique({
        where: { id: interpreterId },
        include: { userProfile: true }
      });

      if (interpreter?.userProfile) {
        const { supabaseAdmin, ADMIN_UNAVAILABLE_MESSAGE, isAdminUnavailableError } = await import('@/lib/supabase/admin');
        try {
          const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
            interpreter.userProfile.id,
            { password, email_confirm: true }
          );
          if (authError) throw authError;
        } catch (err: unknown) {
          if (isAdminUnavailableError(err)) {
            return NextResponse.json(
              { success: false, error: ADMIN_UNAVAILABLE_MESSAGE },
              { status: 503 }
            );
          }
          throw err;
        }
      }
    }

    // 2. Update Interpreter record and keep the linked user profile in sync
    const updated = await prisma.interpreter.update({
      where: { id: interpreterId },
      data: updateData,
    });

    await prisma.userProfile.updateMany({
      where: { interpreterId },
      data: {
        displayName: updated.name,
        ...(updated.emailCorporativo ? { email: updated.emailCorporativo } : {}),
      },
    });

    revalidateInterpreterProfileRecords(interpreterId);
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('Error updating interpreter:', error);
    return apiError({ error, fallback: 'Error updating interpreter' });
  }
}
