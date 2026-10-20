import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { guardApiAuth } from '@/lib/api-auth';
import { apiError } from '@/lib/api-responses';

export async function GET(request: Request) {
  try {
    const denied = await guardApiAuth(request, 'admin');
    if (denied) return denied;

    await prisma.$executeRawUnsafe(`
      ALTER TABLE interpreters 
      ADD COLUMN IF NOT EXISTS payment_frequency TEXT DEFAULT 'Monthly',
      ADD COLUMN IF NOT EXISTS payment_day TEXT DEFAULT '1';
    `);

    await prisma.$executeRawUnsafe(`
      ALTER TABLE production_logs 
      ADD COLUMN IF NOT EXISTS verified_minutes INTEGER;
    `);

    await prisma.$executeRawUnsafe(`
      ALTER TABLE payroll_records 
      ADD COLUMN IF NOT EXISTS verified_minutes INTEGER,
      ADD COLUMN IF NOT EXISTS incentives_total DECIMAL(10, 2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP(3),
      ADD COLUMN IF NOT EXISTS transaction_reference TEXT,
      ADD COLUMN IF NOT EXISTS reconciliation_hash TEXT UNIQUE;
    `);

    return NextResponse.json({
      success: true,
      message: "Database schema successfully patched with all missing columns!",
      databaseUrlPrefix: process.env.DATABASE_URL?.substring(0, 30) || 'Missing',
    });
  } catch (error) {
    return apiError({ error, fallback: 'Database schema patch failed' });
  }
}
