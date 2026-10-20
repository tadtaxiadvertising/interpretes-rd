'use server';

import prismaClient from '@/lib/prisma';
import { z } from 'zod';
import { revalidateInterpreterProfileRecords } from '@/lib/cache/revalidate-interpreter';
import { parse } from 'csv-parse/sync';
import { validateAction } from '@/lib/auth/actions';

const prisma = prismaClient;

// Zod validation for chunks
const LogChunkSchema = z.object({
  headers: z.string(),
  rows: z.array(z.string())
});

interface ParsedRow {
  date: string;
  externalId: string;
  minutes?: string;
  adherence?: string;
  [key: string]: string | undefined;
}

export async function uploadLogChunk(prevState: any, data: { headers: string, rows: string[] }) {
  const authorization = await validateAction('admin');
  if ('error' in authorization) {
    return { success: false, error: authorization.error };
  }

  try {
    const parsed = LogChunkSchema.safeParse(data);
    if (!parsed.success) {
      return { success: false, error: 'Formato de datos inválido en el chunk.' };
    }

    const { headers, rows } = parsed.data;

    // Parse CSV properly using csv-parse/sync (handles quotes, commas in fields, etc.)
    const csvContent = [headers, ...rows].join('\n');
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as ParsedRow[];

    // Find column indices (case-insensitive)
    const firstRecord = records[0];
    if (!firstRecord) {
      return { success: false, error: 'CSV vacío o sin datos válidos.' };
    }

    const keys = Object.keys(firstRecord).map(k => k.toLowerCase());
    const dateKey = keys.find(k => k.includes('date') || k.includes('fecha'));
    const externalIdKey = keys.find(k => k.includes('id') || k.includes('external'));
    const minutesKey = keys.find(k => k.includes('minute') || k.includes('minuto'));
    const adherenceKey = keys.find(k => k.includes('adherence') || k.includes('adherencia'));

    if (!dateKey || !externalIdKey) {
      return { success: false, error: 'CSV requiere columnas: Fecha, External ID.' };
    }

    // Collect unique externalIds for batch lookup
    const externalIds = Array.from(
      new Set(records.map(r => r[externalIdKey]).filter((v): v is string => Boolean(v)))
    );

    // Batch lookup interpreters
    const interpreters = await prisma.interpreter.findMany({
      where: { externalId: { in: externalIds } },
      select: { id: true, externalId: true },
    });

    const interpreterMap = new Map(interpreters.map(i => [i.externalId, i.id]));

    // Prepare production log data for batch insert
    const logsToCreate: Array<{
      interpreterId: number;
      date: Date;
      interpretedMinutes: number;
      adherence: number;
      status: string;
    }> = [];

    const errors: string[] = [];
    let successCount = 0;
    const affectedInterpreterIds = new Set<number>();

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const rowNum = i + 1;

      const dateStr = record[dateKey] as string;
      const externalId = record[externalIdKey] as string;
      const minutes = minutesKey ? parseInt((record[minutesKey] as string) || '0') || 0 : 0;
      const adherence = adherenceKey ? parseFloat((record[adherenceKey] as string) || '0') || 0 : 0;

      if (!dateStr || !externalId) {
        errors.push(`Row ${rowNum}: Missing date or externalId`);
        continue;
      }

      const dateObj = new Date(dateStr);
      if (isNaN(dateObj.getTime())) {
        errors.push(`Row ${rowNum}: Invalid date format`);
        continue;
      }

      const interpreterId = interpreterMap.get(externalId);
      if (!interpreterId) {
        errors.push(`Row ${rowNum}: Interpreter not found for externalId ${externalId}`);
        continue;
      }

      // Create fingerprint for idempotency
      const fingerprint = `${interpreterId}-${dateObj.toISOString().split('T')[0]}-${minutes}-${adherence}`;

      logsToCreate.push({
        interpreterId,
        date: dateObj,
        interpretedMinutes: minutes,
        adherence,
        status: 'Importado',
      });
      affectedInterpreterIds.add(interpreterId);
      successCount++;
    }

    // Batch insert with createMany (skip duplicates via unique constraint)
    if (logsToCreate.length > 0) {
      await prisma.productionLog.createMany({
        data: logsToCreate,
        skipDuplicates: true, // Respects unique constraint on (interpreterId, date) for Manual status
      });
    }

    affectedInterpreterIds.forEach((id) => revalidateInterpreterProfileRecords(id));

    return {
      success: true,
      count: successCount,
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
      error: null,
    };
  } catch (error: any) {
    console.error('❌ ERROR uploadLogChunk:', error);
    return { success: false, error: error.message || 'Error al procesar chunk' };
  }
}