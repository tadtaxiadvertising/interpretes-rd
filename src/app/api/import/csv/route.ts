import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { guardApiAuth } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const db = prisma;
import { 
  InterpreterSchema, 
  ProductionLogSchema, 
  QAScoreSchema,
  parsePercentage,
  parseDecimal,
  parseTime
} from '@/lib/validators';
import csv from 'csv-parser';
import { Readable } from 'stream';

export async function POST(req: NextRequest) {
  try {
    const denied = await guardApiAuth(req, 'admin');
    if (denied) return denied;

    const formData = await req.formData();
    const file = formData.get('file') as File;
    const type = formData.get('type') as string; // 'interpreters' | 'production' | 'qa'
    
    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const stream = Readable.from(buffer);
    
    const results: Record<string, string>[] = [];
    
    await new Promise((resolve, reject) => {
      stream
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', resolve)
        .on('error', reject);
    });

    let successCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    if (type === 'interpreters') {
      for (const row of results) {
        try {
          const validated = InterpreterSchema.parse({
            externalId: row.ID || row.externalId,
            name: row.Name || row.name,
            status: row.Status || row.status || 'Activo',
            campaign: row.Campaign || row.campaign,
            tariffPerMinute: parseFloat(row.Tariff || row.tariffPerMinute || '0.15'),
          });

          await db.interpreter.upsert({
            where: { externalId: validated.externalId },
            update: validated,
            create: validated,
          });
          successCount++;
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : 'Unknown error';
          errorCount++;
          errors.push(`Row ${results.indexOf(row) + 1}: ${message}`);
        }
      }
    } else if (type === 'production') {
      // Pre-fetch accounts for mapping
      const accounts = await db.account.findMany();
      const accountMap = new Map(accounts.map((a: { name: string; id: number }) => [a.name.toLowerCase(), a.id]));

      for (const row of results) {
        try {
          // Find interpreter by externalId or Name
          const interpreter = await db.interpreter.findFirst({
            where: { 
              OR: [
                { externalId: row.InterpreterID || row.ID },
                { name: row.Interpreter || row.Name }
              ]
            }
          });

          if (!interpreter) throw new Error(`Interpreter not found: ${row.InterpreterID || row.Interpreter}`);

          // Try to match account
          const accountName = row.Account || row.account;
          const accountId = accountName ? accountMap.get(accountName.toLowerCase()) : null;

          const validated = ProductionLogSchema.parse({
            interpreterId: interpreter.id,
            date: new Date(row.Date || row.date),
            interpretedMinutes: parseInt(row.Minutes || row.interpretedMinutes || '0'),
            callsAttended: parseInt(row.Calls || row.callsAttended || '0'),
            adherence: parsePercentage(row.Adherence || row.adherence),
            campaign: row.Campaign || row.campaign,
            accountId: accountId
          });

          await db.productionLog.create({ data: validated });
          successCount++;
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : 'Unknown error';
          errorCount++;
          errors.push(`Row ${results.indexOf(row) + 1}: ${message}`);
        }
      }
    }

    return NextResponse.json({ 
      success: true, 
      successCount, 
      errorCount, 
      errors: errors.slice(0, 10) 
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    console.error('Import error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
