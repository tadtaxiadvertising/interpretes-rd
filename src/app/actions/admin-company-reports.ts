'use server';

import { getCurrentProfile } from '@/app/actions/auth';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createHash } from 'node:crypto';

const schema = z.object({
  accountId: z.coerce.number().int().positive(),
  periodStart: z.iso.date(),
  periodEnd: z.iso.date(),
  sourceName: z.string().trim().min(2).max(150),
  reportedMinutes: z.coerce.number().int().nonnegative().max(100000000),
  reportedCalls: z.union([z.literal(''), z.coerce.number().int().nonnegative().max(100000000)]),
  notes: z.string().trim().max(1000),
});

export async function registerCompanyReport(formData: FormData) {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== 'admin') return { success: false, error: 'No autorizado.' };
  const parsed = schema.safeParse(Object.fromEntries(['accountId','periodStart','periodEnd','sourceName','reportedMinutes','reportedCalls','notes'].map(k => [k, formData.get(k) ?? ''])));
  if (!parsed.success) return { success: false, error: 'Datos inválidos. Revisa las fechas y cantidades.' };
  const data = parsed.data;
  if (data.periodEnd < data.periodStart) return { success: false, error: 'El final del período debe ser posterior al inicio.' };
  const sourceChecksum = createHash('sha256').update(JSON.stringify([data.accountId,data.periodStart,data.periodEnd,data.sourceName,data.reportedMinutes,data.reportedCalls,data.notes])).digest('hex');
  try {
    await prisma.companyProductionReport.create({
      data: {
        accountId: data.accountId,
        periodStart: new Date(data.periodStart + 'T00:00:00.000Z'),
        periodEnd: new Date(data.periodEnd + 'T00:00:00.000Z'),
        sourceName: data.sourceName,
        sourceChecksum,
        reportedMinutes: data.reportedMinutes,
        reportedCalls: data.reportedCalls === '' ? null : data.reportedCalls,
        notes: data.notes || null,
      },
    });
    revalidatePath('/admin/reports');
    return { success: true };
  } catch (error) {
    console.error('[COMPANY REPORTS] Registration failed', error);
    return { success: false, error: 'No se pudo registrar el reporte. Puede estar duplicado.' };
  }
}
