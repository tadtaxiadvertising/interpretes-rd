import { z } from 'zod';

// Interpreter Validators
export const InterpreterSchema = z.object({
  externalId: z.string().min(1, 'External ID required'),
  name: z.string().min(2, 'Name must be at least 2 characters'),
  status: z.enum(['Activo', 'Training', 'Inactivo', 'Probation']).default('Activo'),
  campaign: z.string().optional().nullable(),
  languageA: z.string().default('Español'),
  languageB: z.string().default('Inglés'),
  emailCorporativo: z.string().email().optional().nullable(),
  telefono: z.string().optional().nullable(),
  pais: z.string().optional().nullable(),
  metodoPago: z.enum(['PayPal', 'Bank Transfer', 'Payoneer', 'USDT']).optional().nullable(),
  cuentaPago: z.string().optional().nullable(),
  documentosCompleto: z.boolean().default(false),
  notas: z.string().optional().nullable(),
  tariffPerMinute: z.number().positive('Tariff must be positive'),
  password: z.string().min(6, 'Password must be at least 6 characters').optional(),
  monthlyGoal: z.number().int().positive().optional().default(2000),
  paymentFrequency: z.enum(['Weekly', 'Biweekly', 'Monthly']).default('Monthly'),
  paymentDay: z.string().default('1'),
});

export type InterpreterInput = z.infer<typeof InterpreterSchema>;

// Production Log Validators
export const ProductionLogSchema = z.object({
  interpreterId: z.number().positive(),
  date: z.coerce.date(),
  campaign: z.string().optional().nullable(),
  scheduledHours: z.string().optional().nullable(),
  loginTime: z.coerce.date().optional().nullable(),
  logoutTime: z.coerce.date().optional().nullable(),
  connectedHours: z.number().nonnegative().optional().nullable(),
  interpretedMinutes: z.number().nonnegative().default(0),
  verifiedMinutes: z.number().nonnegative().optional().nullable(),
  callsAttended: z.number().nonnegative().default(0),
  adherence: z.number().min(0).max(100).optional().nullable(),
  status: z.string().default('OK'),
  observaciones: z.string().optional().nullable(),
  accountId: z.number().positive().optional().nullable(),
});

export type ProductionLogInput = z.infer<typeof ProductionLogSchema>;

// Account Validators
export const AccountSchema = z.object({
  name: z.string().min(1, 'Account name required'),
  description: z.string().optional().nullable(),
});

export type AccountInput = z.infer<typeof AccountSchema>;

// Interpreter Account Rate Validators
export const InterpreterAccountRateSchema = z.object({
  interpreterId: z.number().positive(),
  accountId: z.number().positive(),
  tariffPerHour: z.number().positive('Tariff must be positive'),
});

export type InterpreterAccountRateInput = z.infer<typeof InterpreterAccountRateSchema>;

// QA Score Validators
export const QAScoreSchema = z.object({
  productionLogId: z.number().positive(),
  interpreterId: z.number().positive(),
  auditDate: z.coerce.date(),
  auditor: z.string().optional().nullable(),
  callDuration: z.number().positive().optional().nullable(),
  callType: z.string().optional().nullable(),
  protocolScore: z.number().min(0).max(20).optional().nullable(),
  interpretationScore: z.number().min(0).max(40).optional().nullable(),
  languageScore: z.number().min(0).max(20).optional().nullable(),
  serviceScore: z.number().min(0).max(10).optional().nullable(),
  technicalScore: z.number().min(0).max(10).optional().nullable(),
  totalScore: z.number().min(0).max(100).optional().nullable(),
  criticalError: z.boolean().default(false),
  comentarios: z.string().optional().nullable(),
  accionRequerida: z.enum(['Ninguna', 'Coaching', 'Advertencia']).optional().nullable(),
});

export type QAScoreInput = z.infer<typeof QAScoreSchema>;

// Payroll Record Validators
export const PayrollRecordSchema = z.object({
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  interpreterId: z.number().positive(),
  totalMinutes: z.number().nonnegative(),
  verifiedMinutes: z.number().nonnegative().optional().nullable(),
  grossTotal: z.number().nonnegative(),
  qualityBonus: z.number().nonnegative().default(0),
  incentivesTotal: z.number().nonnegative().default(0),
  penalidades: z.number().nonnegative().default(0),
  transferDeduction: z.number().nonnegative().default(0),
  netTotal: z.number().nonnegative(),
  status: z.string().default('Pendiente'),
  paymentDate: z.coerce.date().optional().nullable(),
  paidAt: z.coerce.date().optional().nullable(),
  transactionReference: z.string().optional().nullable(),
  reconciliationHash: z.string().optional().nullable(),
});

export type PayrollRecordInput = z.infer<typeof PayrollRecordSchema>;

// Recruitment Candidate Validators
export const RecruitmentCandidateSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email format'),
  telefono: z.string().optional().nullable(),
  pais: z.string().optional().nullable(),
  fuente: z.enum(['LinkedIn', 'Facebook', 'Referido']).optional().nullable(),
  englishLevel: z.enum(['B2', 'C1', 'C2']).optional().nullable(),
  speedtestMbps: z.number().positive().optional().nullable(),
  fechaPostulacion: z.coerce.date(),
  fechaEntrevista: z.coerce.date().optional().nullable(),
  resultRoleplay: z.number().min(0).max(100).optional().nullable(),
  fechaOferta: z.coerce.date().optional().nullable(),
  fechaInicio: z.coerce.date().optional().nullable(),
  responsable: z.string().optional().nullable(),
  notas: z.string().optional().nullable(),
});

export type RecruitmentCandidateInput = z.infer<typeof RecruitmentCandidateSchema>;

// Utilities for CSV parsing
export const parsePercentage = (value: string | undefined): number | null => {
  if (!value) return null;
  const parsed = parseFloat(value.replace('%', '').trim());
  return isNaN(parsed) ? null : parsed;
};

export const parseTime = (timeStr: string | undefined): Date | null => {
  if (!timeStr) return null;
  try {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date;
  } catch {
    return null;
  }
};

export const parseDecimal = (value: string | undefined): number | null => {
  if (!value) return null;
  const parsed = parseFloat(value.replace('$', '').replace(',', '').trim());
  return isNaN(parsed) ? null : parsed;
};
