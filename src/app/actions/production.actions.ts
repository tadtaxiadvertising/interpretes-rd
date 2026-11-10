'use server';

import prismaClient from '@/lib/prisma';
import { z } from 'zod';
import { revalidateInterpreterProfileRecords } from '@/lib/cache/revalidate-interpreter';
import { parse } from 'csv-parse/sync';
import { validateAction } from '@/lib/auth/actions';
import {
  MAX_PRODUCTION_CHUNK_BYTES,
  MAX_PRODUCTION_CHUNK_ROWS,
  parseProductionAdherence,
  parseProductionMinutes,
} from '@/lib/production-csv-validation';

const prisma = prismaClient;

const LogChunkSchema = z.object({
  headers: z.string().min(1).max(16_384),
  rows: z.array(z.string().max(8_192)).min(1).max(MAX_PRODUCTION_CHUNK_ROWS),
});

interface ParsedRow {
  [key: string]: string | undefined;
}

export async function uploadLogChunk(_prevState: unknown, data: { headers: string; rows: string[] }) {
  const authorization = await validateAction('admin');
  if ('error' in authorization) {
    return { success: false, error: authorization.error };
  }

  try {
    const parsed = LogChunkSchema.safeParse(data);
    if (!parsed.success) {
      return { success: false, error: 'El chunk CSV excede los límites o tiene un formato inválido.' };
    }

    const { headers, rows } = parsed.data;
    const csvContent = [headers, ...rows].join('\n');
    if (Buffer.byteLength(csvContent, 'utf8') > MAX_PRODUCTION_CHUNK_BYTES) {
      return { success: false, error: 'El chunk CSV supera el tamaño máximo permitido (2 MB).' };
    }

    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      max_record_size: 8_192,
    }) as ParsedRow[];

    const firstRecord = records[0];
    if (!firstRecord) {
      return { success: false, error: 'CSV vacío o sin datos válidos.' };
    }

    const headerColumns = Object.keys(firstRecord);
    if (headerColumns.length > 100) {
      return { success: false, error: 'El CSV no puede contener más de 100 columnas.' };
    }

    // Preserve original header keys while matching names case-insensitively.
    const normalizedHeaders = headerColumns.map((key) => ({
      key,
      normalized: key.trim().toLowerCase(),
    }));
    const dateKey = normalizedHeaders.find(({ normalized }) =>
      normalized.includes('date') || normalized.includes('fecha'),
    )?.key;
    const externalIdKey = normalizedHeaders.find(({ normalized }) =>
      normalized.includes('id') || normalized.includes('external'),
    )?.key;
    const minutesKey = normalizedHeaders.find(({ normalized }) =>
      normalized.includes('minute') || normalized.includes('minuto'),
    )?.key;
    const adherenceKey = normalizedHeaders.find(({ normalized }) =>
      normalized.includes('adherence') || normalized.includes('adherencia'),
    )?.key;

    if (!dateKey || !externalIdKey) {
      return { success: false, error: 'CSV requiere columnas: Fecha, External ID.' };
    }

    const externalIds = Array.from(
      new Set(records.map((record) => record[externalIdKey]?.trim()).filter(
        (value): value is string => typeof value === 'string' && value.length <= 256,
      )),
    );

    const interpreters = await prisma.interpreter.findMany({
      where: { externalId: { in: externalIds } },
      select: { id: true, externalId: true },
    });
    const interpreterMap = new Map(interpreters.map((interpreter) => [interpreter.externalId, interpreter.id]));

    const logsToCreate: Array<{
      interpreterId: number;
      date: Date;
      interpretedMinutes: number;
      adherence: number;
      status: string;
    }> = [];

    const errors: string[] = [];
    const affectedInterpreterIds = new Set<number>();

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const rowNum = i + 1;
      const dateStr = record[dateKey]?.trim() ?? '';
      const externalId = record[externalIdKey]?.trim() ?? '';
      const minutes = parseProductionMinutes(minutesKey ? record[minutesKey] : undefined);
      const adherence = parseProductionAdherence(adherenceKey ? record[adherenceKey] : undefined);

      if (!dateStr || dateStr.length > 64 || !externalId || externalId.length > 256) {
        errors.push(`Row ${rowNum}: Missing or invalid date/external ID`);
        continue;
      }
      if (minutes === null || adherence === null) {
        errors.push(`Row ${rowNum}: Invalid minutes or adherence value`);
        continue;
      }

      const date = new Date(dateStr);
      if (Number.isNaN(date.getTime())) {
        errors.push(`Row ${rowNum}: Invalid date format`);
        continue;
      }

      const interpreterId = interpreterMap.get(externalId);
      if (!interpreterId) {
        errors.push(`Row ${rowNum}: Interpreter not found for external ID ${externalId}`);
        continue;
      }

      logsToCreate.push({
        interpreterId,
        date,
        interpretedMinutes: minutes,
        adherence,
        status: 'Importado',
      });
      affectedInterpreterIds.add(interpreterId);
    }

    if (logsToCreate.length > 0) {
      await prisma.productionLog.createMany({
        data: logsToCreate,
        skipDuplicates: true,
      });
    }

    for (const interpreterId of affectedInterpreterIds) {
      revalidateInterpreterProfileRecords(interpreterId);
    }

    return {
      success: true,
      count: logsToCreate.length,
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
      error: null,
    };
  } catch (error) {
    console.error('uploadLogChunk failed:', error instanceof Error ? error.message : 'Unknown error');
    return { success: false, error: 'No fue posible procesar el chunk CSV.' };
  }
}
