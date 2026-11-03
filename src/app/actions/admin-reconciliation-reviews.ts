'use server';

import { getCurrentProfile } from '@/app/actions/auth';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const schema = z.object({
  reportId: z.coerce.number().int().positive(),
  decision: z.enum(['MATCHED','DISPUTED','INVESTIGATING','RESOLVED']),
  note: z.string().trim().min(5).max(2000),
});

export async function recordReconciliationReview(formData: FormData) {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== 'admin') return { success: false, error: 'No autorizado.' };
  const parsed = schema.safeParse(Object.fromEntries(['reportId','decision','note'].map(k => [k, formData.get(k) ?? ''])));
  if (!parsed.success) return { success: false, error: 'Revisa el estado, reporte y observación (mínimo 5 caracteres).' };
  const { reportId, decision, note } = parsed.data;
  try {
    const report = await prisma.companyProductionReport.findUnique({ where: { id: reportId } });
    if (!report) return { success: false, error: 'Reporte inexistente.' };
    const totals = await prisma.productionLog.aggregate({
      where: { accountId: report.accountId, date: { gte: report.periodStart, lte: report.periodEnd } },
      _sum: { interpretedMinutes: true, callsAttended: true },
      _count: { _all: true },
    });
    const internalMinutes = totals._sum.interpretedMinutes ?? 0;
    const internalCalls = totals._sum.callsAttended ?? 0;
    if (decision === 'MATCHED' && totals._count._all === 0) {
      return { success: false, error: 'No hay registros internos. No se puede confirmar coincidencia.' };
    }
    if (decision === 'MATCHED' && (internalMinutes !== report.reportedMinutes ||
      (report.reportedCalls !== null && internalCalls !== report.reportedCalls))) {
      return { success: false, error: 'Los minutos o llamadas difieren. Selecciona otro estado y documenta la diferencia.' };
    }
    await prisma.companyReportReview.create({
      data: { reportId, reviewerId: profile.id, decision, note, internalMinutes, externalMinutes: report.reportedMinutes },
    });
    revalidatePath('/admin/reconciliation');
    return { success: true };
  } catch (error) {
    console.error('[RECONCILIATION] Review failed', error);
    return { success: false, error: 'No se pudo guardar la revisión.' };
  }
}
