import prisma from '@/lib/prisma';
import crypto from 'crypto';
import { calculateFullPayroll } from '@/services/PayrollService';
import { PayrollGenerateSchema } from '@/lib/api-schemas';
import { apiError, parseJsonBody } from '@/lib/api-responses';
import { guardApiAuth } from '@/lib/api-auth';
import { privateAdminJson, privateAdminResponse } from '@/lib/security/private-admin-response';
import { safeServerErrorCategory } from '@/lib/security/safe-server-error';

export async function POST(request: Request) {
  try {
    const denied = await guardApiAuth(request, 'admin');
    if (denied) return privateAdminResponse(denied);

    const { targetDate } = await parseJsonBody(request, PayrollGenerateSchema);
    const dateToProcess = targetDate ?? new Date();
    
    // Get day of month and day of week
    const dayOfMonth = dateToProcess.getDate().toString();
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayOfWeek = days[dateToProcess.getDay()];

    // A weekday alone cannot distinguish alternate-week pay cycles. The
    // interpreter model has no biweekly anchor date; treating these accounts as
    // Weekly could prematurely create payroll and mark production as processed.
    // Fail before ANY financial writes, even if weekly/monthly accounts are
    // also due. An explicit calendar/anchor workflow must resolve the cycle.
    const unanchoredBiweekly = await prisma.interpreter.findFirst({
      where: {
        status: 'Activo',
        paymentFrequency: 'Biweekly',
        paymentDay: dayOfWeek,
      },
      select: { id: true },
    });
    if (unanchoredBiweekly) {
      return privateAdminJson({
        success: false,
        code: 'BIWEEKLY_SCHEDULE_UNCONFIGURED',
        error: 'Hay intérpretes con pago cada dos semanas, pero falta una fecha de referencia del ciclo. No se generó ninguna nómina; configura y verifica el calendario antes de reintentar.',
      }, { status: 409 });
    }

    // Only deterministic frequencies may be generated in this legacy API.
    const interpreters = await prisma.interpreter.findMany({
      where: {
        status: 'Activo',
        OR: [
          { paymentFrequency: 'Monthly', paymentDay: dayOfMonth },
          { paymentFrequency: 'Weekly', paymentDay: dayOfWeek },
        ],
      },
    });

    if (interpreters.length === 0) {
      return privateAdminJson({ message: 'No interpreters scheduled for payment today', count: 0 });
    }

    const results = [];

    // Process each interpreter atomically
    for (const interpreter of interpreters) {
      // Find all unprocessed logs
      const unprocessedLogs = await prisma.productionLog.findMany({
        where: {
          interpreterId: interpreter.id,
          status: { not: 'PROCESSED' }
        }
      });

      if (unprocessedLogs.length === 0) continue;

      // Calculate using unified PayrollService
      const periodStartLogs = new Date(Math.min(...unprocessedLogs.map((l: { date: Date }) => l.date.getTime())));
      const periodEndLogs = new Date(Math.max(...unprocessedLogs.map((l: { date: Date }) => l.date.getTime())));
      
      const calculation = await calculateFullPayroll(interpreter.id, periodStartLogs, periodEndLogs);

      const periodStart = periodStartLogs;
      const periodEnd = periodEndLogs;

      // Unique reconciliation hash (stable: no Date.now())
          const reconciliationHash = crypto
            .createHash('sha256')
            .update(`${interpreter.id}-${periodStart.toISOString()}-${periodEnd.toISOString()}`)
            .digest('hex');

          try {
            // Atomic transaction with serializable isolation to prevent race conditions
            const result = await prisma.$transaction(
              async (tx: any) => {
                const payroll = await tx.payrollRecord.create({
                  data: {
                    interpreterId: interpreter.id,
                    periodStart,
                    periodEnd,
                    totalMinutes: calculation.totalMinutes,
                    verifiedMinutes: calculation.totalMinutes,
                    grossTotal: calculation.grossTotal,
                    qualityBonus: calculation.qualityBonus,
                    incentivesTotal: calculation.incentivesTotal,
                    penalidades: calculation.penalidades,
                    transferDeduction: calculation.transferDeduction,
                    netTotal: calculation.netTotal,
                    status: 'PENDING',
                    reconciliationHash,
                  },
                });

                // Mark logs as processed
                await tx.productionLog.updateMany({
                  where: {
                    id: { in: unprocessedLogs.map((l: { id: number }) => l.id) },
                  },
                  data: {
                    status: 'PROCESSED',
                  },
                });

                return payroll;
              },
              {
                isolationLevel: 'Serializable',
              }
            );
        
        results.push({ interpreterId: interpreter.id, payrollId: result.id, status: 'Success' });
      } catch (err) {
        // The per-interpreter response is public to the authenticated caller:
        // never put Prisma/DB provider messages into the returned results.
        console.error('Payroll generation failed for one interpreter:', safeServerErrorCategory(err));
        results.push({ interpreterId: interpreter.id, error: 'No se pudo procesar este registro de nómina.', status: 'Failed' });
      }
    }

    return privateAdminJson({ success: true, results });

  } catch (error) {
    console.error('Payroll generation request failed:', safeServerErrorCategory(error));
    return privateAdminResponse(apiError({ error, fallback: 'Internal Server Error', exposeMessage: false }));
  }
}
