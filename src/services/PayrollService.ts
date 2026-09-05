import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';

const db = prisma;

// ============================================================
// PayrollService â€” Motor de NÃ³mina e Incentivos
// LÃ³gica aislada para cÃ¡lculos financieros contra SystemConfig
// ============================================================

/** Estructura de un tier de incentivos leÃ­do desde SystemConfig */
interface IncentiveTier {
  minHours: number;
  bonus: number; // Decimal amount stored as number for calc
}

/** Resultado del cÃ¡lculo unificado de tiempo */
interface UnifiedTimeResult {
  importedMinutes: number;
  realtimeMinutes: number;
  totalMinutes: number;
  totalHours: number;
}

/** Resultado del cÃ¡lculo completo de incentivos */
interface IncentiveResult {
  totalIncentive: number;
  matchedTier: string | null; // Key name of the matched tier
}

interface ProductionLogRecord {
  interpretedMinutes: number | null;
  verifiedMinutes: number | null;
  accountId: number | null;
}

interface CallSessionRecord {
  durationSeconds: number | null;
  callCost: Prisma.Decimal | null;
}

interface QAScoreRecord {
  totalScore: Prisma.Decimal | null;
  criticalError: boolean | null;
}

/** Resultado completo del motor de nÃ³mina con incentivos */
export interface PayrollCalculationResult {
  interpreterId: number;
  interpreterName: string;
  totalMinutes: number;
  totalHours: number;
  tariffPerMinute: number;
  grossTotal: number;
  incentivesTotal: number;
  matchedTier: string | null;
  qualityBonus: number;
  penalidades: number;
  transferDeduction: number;
  netTotal: number;
}

/**
 * Lee los tiers de incentivos desde la tabla SystemConfig.
 * Formato esperado en DB:
 *   key: "tier1_hours" â†’ value: "100"  (horas mÃ­nimas)
 *   key: "tier1_bonus" â†’ value: "50.00" (monto bono)
 *   key: "tier2_hours" â†’ value: "150"
 *   key: "tier2_bonus" â†’ value: "100.00"
 *   key: "tier3_hours" â†’ value: "200"
 *   key: "tier3_bonus" â†’ value: "200.00"
 */
export async function getIncentiveTiers(): Promise<IncentiveTier[]> {
  const configs = await db.systemConfig.findMany({
    where: {
      key: {
        startsWith: 'tier',
      },
    },
  });

  // Agrupa por nÃºmero de tier
  const tierMap = new Map<number, Partial<IncentiveTier>>();

  for (const config of configs) {
    const match = config.key.match(/^tier(\d+)_(hours|bonus)$/);
    if (!match) continue;

    const tierNum = parseInt(match[1], 10);
    const field = match[2]; // 'hours' or 'bonus'

    if (!tierMap.has(tierNum)) {
      tierMap.set(tierNum, {});
    }

    const tier = tierMap.get(tierNum)!;
    if (field === 'hours') {
      tier.minHours = parseInt(config.value, 10);
    } else if (field === 'bonus') {
      tier.bonus = parseFloat(config.value);
    }
  }

  // Filtra tiers completos y ordena descendente por horas para matching
  const tiers: IncentiveTier[] = [];
  for (const [, partial] of tierMap) {
    if (partial.minHours != null && partial.bonus != null) {
      tiers.push({ minHours: partial.minHours, bonus: partial.bonus });
    }
  }

  // Orden descendente: el tier mÃ¡s alto primero para que matchee el mejor bono
  tiers.sort((a, b) => b.minHours - a.minHours);

  return tiers;
}

/**
 * Unifica las horas de production_logs
 * para un intérprete en un período dado.
 *
 * ProductionLogs is the single source of truth — endCall() syncs live calls
 * into ProductionLog, and the /api/v1/sync route backfills older sessions.
 * Adding callSessions here would double-count minutes already present in
 * productionLogs.
 */
export async function calculateUnifiedTime(
  interpreterId: number,
  periodStart: Date,
  periodEnd: Date
): Promise<UnifiedTimeResult> {
  // 1. Minutos de production_logs (CSV imports + Manual logs + synced live calls)
  const productionLogs = await db.productionLog.findMany({
    where: {
      interpreterId,
      date: { gte: periodStart, lte: periodEnd },
    },
    select: { interpretedMinutes: true, verifiedMinutes: true, accountId: true },
  }) as ProductionLogRecord[];

  const importedMinutes = (productionLogs || []).reduce(
    (sum: number, log: ProductionLogRecord) => {
      const effectiveMinutes = log.verifiedMinutes !== null ? log.verifiedMinutes : (log.interpretedMinutes || 0);
      return sum + effectiveMinutes;
    },
    0
  );

  const totalMinutes = importedMinutes;
  const totalHours = Math.round((totalMinutes / 60) * 100) / 100;

  return { importedMinutes, realtimeMinutes: 0, totalMinutes, totalHours };
}

/**
 * Calcula el bono de incentivo dinÃ¡micamente basado en los tiers de SystemConfig.
 * Retorna el bono del tier mÃ¡s alto que el intÃ©rprete haya alcanzado.
 */
export async function calculateIncentive(totalHours: number): Promise<IncentiveResult> {
  const tiers = await getIncentiveTiers();

  // Busca el tier mÃ¡s alto alcanzado (ya estÃ¡n ordenados descendente)
  for (const tier of tiers) {
    if (totalHours >= tier.minHours) {
      // Reconstruir el key para saber cuÃ¡l tier matcheÃ³
      const tierIndex = tiers.indexOf(tier);
      const tierName = `tier${tiers.length - tierIndex}`;
      return {
        totalIncentive: tier.bonus,
        matchedTier: tierName,
      };
    }
  }

  return { totalIncentive: 0, matchedTier: null };
}

/**
 * Motor de cálculo completo: unifica tiempo + incentivos + QA + penalidades.
 * Siguiendo estrictamente las reglas de negocio v3.
 */
export async function calculateFullPayroll(
  interpreterId: number,
  periodStart: Date,
  periodEnd: Date
): Promise<PayrollCalculationResult> {
  // 1. Obtener intérprete con sus metadatos financieros
  const interpreter = await db.interpreter.findUnique({
    where: { id: interpreterId },
    select: {
      id: true,
      name: true,
      tariffPerMinute: true,
      metodoPago: true,
      monthlyGoal: true,
    },
  });

  if (!interpreter) {
    throw new Error(`Interpreter ${interpreterId} not found`);
  }

  // Regla C: Manejo seguro de Decimal
  const baseRatePerMinute = parseFloat(interpreter.tariffPerMinute.toString());

  // 2. Obtener logs de producción (single source of truth: incluye imports,
  //    logs manuales y llamadas sincronizadas desde el timer en vivo)
  const productionLogs = await db.productionLog.findMany({
    where: {
      interpreterId,
      date: { gte: periodStart, lte: periodEnd },
    },
    select: { interpretedMinutes: true, verifiedMinutes: true },
  }) as ProductionLogRecord[];

  // 4. Cálculos de Minutos
  // ProductionLogs is the single source of truth.
  // endCall() syncs live calls into ProductionLog, and the /api/v1/sync
  // route backfills older sessions. Adding callSessions here would
  // double-count minutes already present in productionLogs.
  const interpretedSum = (productionLogs || []).reduce((sum: number, log: ProductionLogRecord) => {
    const effective = log.verifiedMinutes !== null ? log.verifiedMinutes : (log.interpretedMinutes || 0);
    return sum + effective;
  }, 0);

  // Minutos Totales Base
  const totalMinutes = Math.round(interpretedSum * 100) / 100;
  const totalHours = Math.round((totalMinutes / 60) * 100) / 100;

  // 5. Cálculo Bruto (Regla: minutos_finales * tariffPerMinute)
  const grossTotal = Math.round(totalMinutes * baseRatePerMinute * 100) / 100;

  // 6. Incentivos dinámicos
  const incentive = await calculateIncentive(totalHours);

  // 7. Quality bonus (QA) con Regla de Auto-Fail
  let qualityBonus = 0;
  const qaScores = await db.qAScore.findMany({
    where: {
      interpreterId,
      auditDate: { gte: periodStart, lte: periodEnd },
    },
    select: { totalScore: true, criticalError: true },
  }) as QAScoreRecord[];

  if (qaScores && qaScores.length > 0) {
    const avgQA = qaScores.reduce((sum: number, qa: QAScoreRecord) => {
      // Auto-Fail Rule
      const score = qa.criticalError ? 0 : (parseFloat(qa.totalScore?.toString() || '0') || 0);
      return sum + score;
    }, 0) / qaScores.length;

    // El bono se aplica si el promedio es >= 90 (Asumido por lógica previa, no especificado cambio)
    if (avgQA >= 90) {
      qualityBonus = Math.round(grossTotal * 0.05 * 100) / 100;
    }
  }

  // 8. Penalidades por errores críticos (10% del gross por cada uno)
  let penalidades = 0;
  const criticalErrors = (qaScores || []).filter((qa: QAScoreRecord) => qa.criticalError).length;
  if (criticalErrors > 0) {
    penalidades = Math.round(grossTotal * 0.1 * criticalErrors * 100) / 100;
  }

  // 8.5. Penalidades / Recuperaciones por Metas (Q1 / Q2)
  const isQ1 = periodStart.getDate() < 16;
  const PENALTY_PER_HOUR = 50;
  const penaltyPerMinute = PENALTY_PER_HOUR / 60;
  let q1Refund = 0;
  let superGoalBonus = 0;

  if (isQ1) {
    const q1Goal = interpreter.monthlyGoal / 2;
    if (totalMinutes < q1Goal) {
      const q1GoalPenalty = Math.round(totalMinutes * penaltyPerMinute * 100) / 100;
      penalidades += q1GoalPenalty;
    }
  } else {
    // Es Q2
    const firstDayOfMonth = new Date(periodStart.getFullYear(), periodStart.getMonth(), 1);
    const fifteenthDay = new Date(periodStart.getFullYear(), periodStart.getMonth(), 15);
    
    // Buscar registro de nómina de Q1
    const q1Record = await db.payrollRecord.findFirst({
      where: {
        interpreterId,
        periodStart: { gte: firstDayOfMonth },
        periodEnd: { lte: fifteenthDay },
      },
      select: { totalMinutes: true }
    });
    
    const q1Minutes = q1Record?.totalMinutes || 0;
    const accumulatedMinutes = q1Minutes + totalMinutes;
    
    if (accumulatedMinutes >= interpreter.monthlyGoal) {
      // Reembolso de Q1
      const q1Goal = interpreter.monthlyGoal / 2;
      if (q1Minutes < q1Goal) {
        q1Refund = Math.round(q1Minutes * penaltyPerMinute * 100) / 100;
      }
      
      // Super Goal Bonus (160% of monthly goal)
      const superGoalMinutes = Math.round((interpreter.monthlyGoal / 100) * 160);
      if (accumulatedMinutes >= superGoalMinutes) {
        superGoalBonus = 50.00;
      }
    } else {
      // Penalidad en Q2
      const q2GoalPenalty = Math.round(totalMinutes * penaltyPerMinute * 100) / 100;
      penalidades += q2GoalPenalty;
    }
  }

  // 9. Deducción de Pasarela (Regla: PayPal 5%, Local 0%)
  let transferDeduction = 0;
  if (interpreter.metodoPago === 'PayPal') {
    transferDeduction = Math.round(grossTotal * 0.05 * 100) / 100;
  } else if (interpreter.metodoPago === 'Bank Transfer') {
    // Asumimos Bank Transfer como local si no es PayPal, según instrucción
    transferDeduction = 0;
  }

  // 10. Cálculo Neto Consolidado
  // netTotal = (grossTotal + qualityBonus + incentivesTotal) - (penalidades + transferDeduction)
  const finalIncentives = incentive.totalIncentive + q1Refund + superGoalBonus;
  const netTotal = Math.max(
      0,
      Math.round(((grossTotal + qualityBonus + finalIncentives) - (penalidades + transferDeduction)) * 100) / 100
    );

  return {
    interpreterId: interpreter.id,
    interpreterName: interpreter.name,
    totalMinutes,
    totalHours,
    tariffPerMinute: baseRatePerMinute,
    grossTotal,
    incentivesTotal: finalIncentives,
    matchedTier: incentive.matchedTier,
    qualityBonus,
    penalidades,
    transferDeduction,
    netTotal,
  };
}


/**
 * Recalcula netTotal cuando el admin sobrescribe los minutos verificados.
 */
export async function recalculateWithVerifiedMinutes(
  payrollRecordId: string,
  verifiedMinutes: number
): Promise<{
  grossTotal: number;
  incentivesTotal: number;
  transferDeduction: number;
  netTotal: number;
}> {
  const record = await db.payrollRecord.findUnique({
    where: { id: payrollRecordId },
    include: {
      interpreter: {
        select: { tariffPerMinute: true, metodoPago: true },
      },
    },
  });

  if (!record) {
    throw new Error(`PayrollRecord ${payrollRecordId} not found`);
  }

  const baseRatePerMinute = record.interpreter ? parseFloat(record.interpreter.tariffPerMinute.toString()) : 0;
  const grossTotal = Math.round(verifiedMinutes * baseRatePerMinute * 100) / 100;

  const verifiedHours = Math.round((verifiedMinutes / 60) * 100) / 100;
  const incentive = await calculateIncentive(verifiedHours);

  const qualityBonus = record.qualityBonus ? parseFloat(record.qualityBonus.toString()) : 0;
  const penalidades = record.penalidades ? parseFloat(record.penalidades.toString()) : 0;

  // Regla de Pasarela: PayPal 5%, Local 0%
  let transferDeduction = 0;
  if (record.interpreter?.metodoPago === 'PayPal') {
    transferDeduction = Math.round(grossTotal * 0.05 * 100) / 100;
  }

  const netTotal = Math.max(
      0,
      Math.round(((grossTotal + qualityBonus + incentive.totalIncentive) - (penalidades + transferDeduction)) * 100) / 100
    );

  return {
    grossTotal,
    incentivesTotal: incentive.totalIncentive,
    transferDeduction,
    netTotal,
  };
}

/**
 * Busca y actualiza un registro de nómina existente si está en estado 'PENDING'.
 */
export async function refreshPayrollRecord(
  interpreterId: number,
  dateWithinPeriod: Date
): Promise<void> {
  const record = await db.payrollRecord.findFirst({
    where: {
      interpreterId,
      periodStart: { lte: dateWithinPeriod },
      periodEnd: { gte: dateWithinPeriod },
      status: { in: ['Pendiente', 'PENDING'] }
    }
  });

  if (record) {
    const calc = await calculateFullPayroll(interpreterId, record.periodStart, record.periodEnd);
    await db.payrollRecord.update({
      where: { id: record.id },
      data: {
        totalMinutes: calc.totalMinutes,
        grossTotal: calc.grossTotal,
        qualityBonus: calc.qualityBonus,
        incentivesTotal: calc.incentivesTotal,
        penalidades: calc.penalidades,
        transferDeduction: calc.transferDeduction,
        netTotal: calc.netTotal,
        verifiedMinutes: calc.totalMinutes
      }
    });
  }
}

