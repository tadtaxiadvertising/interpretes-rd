import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { recalculateWithVerifiedMinutes } from '@/services/PayrollService';
import { PayrollVerifySchema } from '@/lib/api-schemas';
import { apiError, parseJsonBody } from '@/lib/api-responses';
import { guardApiAuth } from '@/lib/api-auth';

const db = prisma;

/**
 * POST /api/payroll/verify
 * Admin endpoint para la conciliación de nómina.
 * 
 * Acciones soportadas:
 * 1. Sobrescribir horas verificadas y recalcular totales
 * 2. Marcar registro como "Pagado" con timestamp
 * 3. Cambiar status del registro
 * 
 * Body:
 * {
 *   payrollRecordId: string       (required)
 *   action: "verify" | "markPaid" | "updateStatus" (required)
 *   verifiedMinutes?: number      (required for action="verify")
 *   status?: string               (required for action="updateStatus")
 * }
 */
export async function POST(request: Request) {
  try {
    const denied = await guardApiAuth(request, 'admin');
    if (denied) return denied;

    const body = await parseJsonBody(request, PayrollVerifySchema);
    const { payrollRecordId, action } = body;
    const verifiedMinutes = action === 'verify' ? body.verifiedMinutes : undefined;
    const status = action === 'updateStatus' ? body.status : undefined;

    // Verificar que el registro existe
    const existing = await db.payrollRecord.findUnique({
      where: { id: payrollRecordId },
      select: { id: true, status: true },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: `PayrollRecord ${payrollRecordId} not found` },
        { status: 404 }
      );
    }

    // ── ACTION: VERIFY ──
    if (action === 'verify') {
      if (verifiedMinutes == null || typeof verifiedMinutes !== 'number' || verifiedMinutes < 0) {
        return NextResponse.json(
          { success: false, error: 'verifiedMinutes must be a non-negative number' },
          { status: 400 }
        );
      }

      // Recalcular con los minutos verificados
      const recalc = await recalculateWithVerifiedMinutes(payrollRecordId, verifiedMinutes);

      const updated = await db.payrollRecord.update({
        where: { id: payrollRecordId },
        data: {
          verifiedMinutes: verifiedMinutes,
          grossTotal: recalc.grossTotal,
          incentivesTotal: recalc.incentivesTotal,
          transferDeduction: recalc.transferDeduction,
          netTotal: recalc.netTotal,
          status: 'APPROVED',
        },
        include: {
          interpreter: {
            select: { name: true, externalId: true },
          },
        },
      });

      return NextResponse.json({
        success: true,
        message: `Record verified with ${verifiedMinutes} minutes`,
        record: updated,
      });
    }

    // ── ACTION: MARK PAID ──
    if (action === 'markPaid') {
      const now = new Date();

      const updated = await db.payrollRecord.update({
        where: { id: payrollRecordId },
        data: {
          status: 'PAID',
          paidAt: now,
          paymentDate: now,
        },
        include: {
          interpreter: {
            select: { name: true, externalId: true },
          },
        },
      });

      return NextResponse.json({
        success: true,
        message: `Record marked as paid at ${now.toISOString()}`,
        record: updated,
      });
    }

    // ── ACTION: UPDATE STATUS ──
    if (action === 'updateStatus') {
      const validStatuses = ['PENDING', 'APPROVED', 'PAID', 'REJECTED'];
      if (!status || !validStatuses.includes(status)) {
        return NextResponse.json(
          { success: false, error: `status must be one of: ${validStatuses.join(', ')}` },
          { status: 400 }
        );
      }

      const data: Record<string, unknown> = { status };
      if (status === 'PAID') {
        data.paidAt = new Date();
        data.paymentDate = new Date();
      }

      const updated = await db.payrollRecord.update({
        where: { id: payrollRecordId },
        data,
        include: {
          interpreter: {
            select: { name: true, externalId: true },
          },
        },
      });

      return NextResponse.json({
        success: true,
        message: `Status updated to ${status}`,
        record: updated,
      });
    }

    return NextResponse.json({ success: false, error: 'Unhandled action' }, { status: 400 });
  } catch (error) {
    console.error('[POST /api/payroll/verify] Error:', error);
    return apiError({ error, fallback: 'Internal server error' });
  }
}
