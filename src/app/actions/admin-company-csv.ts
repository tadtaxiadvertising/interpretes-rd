'use server';

import { getCurrentProfile } from '@/app/actions/auth';
import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { validateCompanyCsvHeaders } from '@/lib/company-csv-validation';
import { nonNegativeIntegerInput } from '@/lib/company-report-validation';

const MAX_BYTES = 1024 * 1024;
const MAX_ROWS = 500;
const rowSchema = z.object({
  accountId: z.coerce.number().int().positive(),
  periodStart: z.iso.date(),
  periodEnd: z.iso.date(),
  sourceName: z.string().trim().min(2).max(150),
  reportedMinutes: nonNegativeIntegerInput,
  reportedCalls: z.union([z.literal(''), nonNegativeIntegerInput]),
  notes: z.string().trim().max(1000),
});

type ImportResult = { success: boolean; error?: string; inserted?: number; duplicates?: number };

export async function importCompanyReportsCsv(formData: FormData): Promise<ImportResult> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== 'admin') return { success: false, error: 'No autorizado.' };
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0 || file.size > MAX_BYTES || !file.name.toLowerCase().endsWith('.csv')) {
    return { success: false, error: 'Selecciona un archivo CSV de hasta 1 MB.' };
  }
  let records: Record<string, string>[];
  try {
    const csv = await file.text();
    records = parse(csv, {
      columns: validateCompanyCsvHeaders, bom: true, skip_empty_lines: true, trim: true,
      relax_quotes: false, skip_records_with_error: false,
      max_record_size: 4096, relax_column_count: false,
    }) as Record<string, string>[];
  } catch {
    return { success: false, error: 'El archivo CSV no tiene un formato válido.' };
  }
  if (!records.length || records.length > MAX_ROWS) return { success: false, error: 'El CSV debe contener entre 1 y 500 filas.' };
  const required = ['accountId','periodStart','periodEnd','sourceName','reportedMinutes','reportedCalls','notes'];
  if (records.some(row => required.some(key => !Object.hasOwn(row, key)))) {
    return { success: false, error: 'Faltan columnas. Usa la plantilla con las siete columnas requeridas.' };
  }
  const data = [];
  for (let index = 0; index < records.length; index++) {
    const parsed = rowSchema.safeParse(records[index]);
    if (!parsed.success || (parsed.success && parsed.data.periodEnd < parsed.data.periodStart)) {
      return { success: false, error: `Datos inválidos en la fila ${index + 2}. No se importó ninguna fila.` };
    }
    const row = parsed.data;
    const checksum = createHash('sha256').update(JSON.stringify([row.accountId,row.periodStart,row.periodEnd,row.sourceName,row.reportedMinutes,row.reportedCalls,row.notes])).digest('hex');
    data.push({
      accountId: row.accountId,
      periodStart: new Date(row.periodStart + 'T00:00:00.000Z'),
      periodEnd: new Date(row.periodEnd + 'T00:00:00.000Z'),
      sourceName: row.sourceName,
      sourceChecksum: checksum,
      reportedMinutes: row.reportedMinutes,
      reportedCalls: row.reportedCalls === '' ? null : row.reportedCalls,
      notes: row.notes || null,
    });
  }
  try {
    const accountIds = [...new Set(data.map(row => row.accountId))];
    const existing = await prisma.account.findMany({ where: { id: { in: accountIds } }, select: { id: true } });
    if (existing.length !== accountIds.length) return { success: false, error: 'El archivo contiene cuentas inexistentes. No se importó ninguna fila.' };
    const result = await prisma.companyProductionReport.createMany({ data, skipDuplicates: true });
    revalidatePath('/admin/reports');
    revalidatePath('/admin/reconciliation');
    return { success: true, inserted: result.count, duplicates: data.length - result.count };
  } catch (error) {
    console.error('[COMPANY REPORTS] CSV import failed', error);
    return { success: false, error: 'No se pudo importar el CSV. No se confirma ninguna importación.' };
  }
}
