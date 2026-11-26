import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { PayrollRecordPatchSchema } from '@/lib/api-schemas';
import { apiError, parseJsonBody, stringIdParamSchema } from '@/lib/api-responses';
import { guardApiAuth } from '@/lib/api-auth';
import { corsHeaders } from '@/lib/cors';
import { privateAdminJson, privateAdminResponse } from '@/lib/security/private-admin-response';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';

const METHODS = 'GET, PATCH, DELETE, OPTIONS';

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request, METHODS) });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const denied = await guardApiAuth(request, 'admin');
    if (denied) return privateAdminResponse(denied);

    const { id } = stringIdParamSchema.parse(await params);

    const record = await prisma.payrollRecord.findUnique({
      where: { id },
      include: { interpreter: true }
    });

    if (!record) {
      return privateAdminJson({ success: false, error: 'Payroll record not found' }, { status: 404 });
    }

    return privateAdminJson(record, {
      headers: corsHeaders(request, METHODS),
    });
  } catch (error) {
    console.error('Error fetching payroll record:', safeServerErrorCategory(error));
    return privateAdminResponse(apiError({ error, fallback: 'Unable to fetch payroll record', exposeMessage: false }));
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const denied = await guardApiAuth(request, 'admin');
    if (denied) return privateAdminResponse(denied);

    const { id } = stringIdParamSchema.parse(await params);

    const body = await parseJsonBody(request, PayrollRecordPatchSchema.strict());
    
    // Generic edits bypass the calculation, approval and payment guards.
    // Retain the route for old clients, but never silently mutate financial data.
    if (Object.keys(body).length > 0) {
      return privateAdminJson({
        success: false,
        code: 'PAYROLL_WORKFLOW_REQUIRED',
        error: 'Utiliza las operaciones específicas de ajustes, verificación o pago del módulo Nómina.',
      }, { status: 409, headers: corsHeaders(request, METHODS) });
    }
    const record = await prisma.payrollRecord.findUnique({ where: { id } });
    if (!record) return privateAdminJson({ success: false, error: 'Payroll record not found' }, { status: 404 });
    return privateAdminJson(record, { headers: corsHeaders(request, METHODS) });
  } catch (error) {
    console.error('Error updating payroll record:', safeServerErrorCategory(error));
    const isPrismaError = error && typeof error === 'object' && 'code' in error;
    if (isPrismaError && error.code === 'P2025') {
      return privateAdminJson({ success: false, error: 'Payroll record not found' }, { status: 404 });
    }
    return privateAdminResponse(apiError({ error, fallback: 'Unable to update payroll record', exposeMessage: false }));
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const denied = await guardApiAuth(request, 'admin');
    if (denied) return privateAdminResponse(denied);

    const { id } = stringIdParamSchema.parse(await params);

    const result = await prisma.$transaction(async tx => {
      const deleted = await tx.payrollRecord.deleteMany({
        where: {
          id, status: 'Draft', paidAt: null, paymentDate: null,
          transactionReference: null, reconciliationHash: null,
          productionLogs: { none: {} }, callSessions: { none: {} },
        },
      });
      if (deleted.count === 1) return 'DELETED';
      const existing = await tx.payrollRecord.findUnique({ where: { id }, select: { id: true } });
      return existing ? 'PROTECTED' : 'NOT_FOUND';
    }, { isolationLevel: 'Serializable' });
    if (result === 'NOT_FOUND') return privateAdminJson({ success: false, error: 'Payroll record not found' }, { status: 404 });
    if (result !== 'DELETED') return privateAdminJson({
      success: false, code: 'PAYROLL_PROTECTED',
      error: 'Solo se pueden eliminar borradores sin pagos, referencias ni registros de producción asociados.',
    }, { status: 409, headers: corsHeaders(request, METHODS) });

    return privateAdminJson({ success: true, message: 'Payroll record deleted successfully' }, {
      headers: corsHeaders(request, METHODS),
    });
  } catch (error) {
    console.error('Error deleting payroll record:', safeServerErrorCategory(error));
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2034') {
      return privateAdminJson({ success: false, code: 'CONFLICT', error: 'La nómina cambió durante la operación. Revisa su estado.' }, { status: 409 });
    }
    return privateAdminResponse(apiError({ error, fallback: 'Unable to delete payroll record', exposeMessage: false }));
  }
}
