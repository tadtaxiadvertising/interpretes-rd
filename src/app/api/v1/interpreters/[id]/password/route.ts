import prisma from '@/lib/prisma';
import { guardApiAuth } from '@/lib/api-auth';
import { InterpreterPasswordSchema } from '@/lib/api-schemas';
import { apiError, numericIdParamSchema, parseJsonBody } from '@/lib/api-responses';
import { privateAdminJson, privateAdminResponse } from '@/lib/security/private-admin-response';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';
import { ZodError } from 'zod';

/**
 * Cookie/Bearer admin guard is evaluated before any ID, body or database read.
 * Treat all error paths as private: reset failures must never expose Auth
 * provider messages, account details or credentials to the client or logs.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const denied = await guardApiAuth(request, 'admin');
    if (denied) return privateAdminResponse(denied);

    const { id: interpreterId } = numericIdParamSchema.parse(await params);
    const { password } = await parseJsonBody(request, InterpreterPasswordSchema);

    const interpreter = await prisma.interpreter.findUnique({
      where: { id: interpreterId },
      include: { userProfile: true },
    });
    if (!interpreter?.userProfile) {
      return privateAdminJson(
        { success: false, error: 'Interpreter or user profile not found' },
        { status: 404 },
      );
    }

    const { supabaseAdmin, isAdminUnavailableError } = await import('@/lib/supabase/admin');
    try {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(
        interpreter.userProfile.id,
        { password, email_confirm: true },
      );
      if (error) throw error;
    } catch (error: unknown) {
      if (isAdminUnavailableError(error)) {
        return privateAdminJson(
          { success: false, error: 'Authentication administration is unavailable.' },
          { status: 503 },
        );
      }
      throw error;
    }

    return privateAdminJson({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    // Expected validation failures should not disclose raw submitted values.
    if (error instanceof ZodError) {
      return privateAdminJson(
        { success: false, error: 'Invalid interpreter ID or password.' },
        { status: 400 },
      );
    }
    console.error('Error resetting interpreter password:', safeServerErrorCategory(error));
    return privateAdminResponse(apiError({
      error,
      fallback: 'Error resetting password',
      exposeMessage: false,
    }));
  }
}
