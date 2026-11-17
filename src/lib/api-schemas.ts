import { z } from 'zod';
import { InterpreterSchema, PayrollRecordSchema, QAScoreSchema, RecruitmentCandidateSchema } from '@/lib/validators';

export const ManualCallSchema = z.object({
  durationMinutes: z.coerce.number().min(0),
  seconds: z.coerce.number().int().min(0).max(59).default(0),
}).refine((data) => data.durationMinutes > 0 || data.seconds > 0, {
  message: 'Duration must be greater than zero',
  path: ['durationMinutes'],
});

export const PresenceSchema = z.object({
  status: z.enum(['Online', 'Offline', 'Busy', 'Away']).optional(),
  type: z.enum(['heartbeat', 'online', 'offline', 'status_change']).optional(),
  reason: z.string().optional(),
  tabId: z.string().optional(),
}).passthrough();

export const IncentiveTierSchema = z.object({
  tierNumber: z.number().int().positive().max(20),
  hours: z.number().min(0).max(10000),
  bonus: z.number().min(0).max(1000000),
});

export const IncentiveConfigSchema = z.object({
  tiers: z.array(IncentiveTierSchema).min(1).max(20),
});

export const PayrollGenerateSchema = z.object({
  targetDate: z.coerce.date().optional(),
});

// A PATCH must not inject defaults from the interpreter creation schema.
// In Zod 4, .partial() can retain defaults from the original fields, which
// would otherwise reset status, languages, goals or payment settings.
export const InterpreterPatchSchema = InterpreterSchema.partial().omit({ password: true }).extend({
  status: z.enum(['Activo', 'Training', 'Inactivo', 'Probation']).optional(),
  languageA: z.string().optional(),
  languageB: z.string().optional(),
  documentosCompleto: z.boolean().optional(),
  monthlyGoal: z.number().int().positive().optional(),
  paymentFrequency: z.enum(['Weekly', 'Biweekly', 'Monthly']).optional(),
  paymentDay: z.string().optional(),
  password: z.string().min(6, 'Password must be at least 6 characters').max(128).optional(),
});

export const InterpreterPasswordSchema = z.object({
  password: z.string().min(6, 'Password must be at least 6 characters').max(128),
});

// PATCH must not insert CREATE defaults for omitted monetary fields.
// Zod's .partial() alone still applies nested .default(0) schemas, which
// silently resets existing bonuses/deductions when editing only a status.
export const PayrollRecordPatchSchema = PayrollRecordSchema.partial().extend({
  qualityBonus: z.number().nonnegative().optional(),
  incentivesTotal: z.number().nonnegative().optional(),
  penalidades: z.number().nonnegative().optional(),
  transferDeduction: z.number().nonnegative().optional(),
  status: z.string().optional(),
});
// The legacy CREATE endpoint accepts weighted point contributions (20/40/20/10/10).
// Stored QA dimensions and the admin PATCH endpoint use canonical 0–100 percentages.
// Audit ownership and the calculated total are immutable from generic PATCH; changes
// to these fields require an explicit audited workflow rather than relinking history.
// Build an explicit object to avoid carrying the CREATE criticalError default into PATCH.
const QAPercentage = z.number().finite().min(0).max(100).nullable().optional();
export const QAScorePatchSchema = z.object({
  auditDate: z.coerce.date().optional(),
  auditor: z.string().max(255).nullable().optional(),
  callDuration: z.number().int().positive().nullable().optional(),
  callType: z.string().max(100).nullable().optional(),
  protocolScore: QAPercentage,
  interpretationScore: QAPercentage,
  languageScore: QAPercentage,
  serviceScore: QAPercentage,
  technicalScore: QAPercentage,
  criticalError: z.boolean().optional(),
  comentarios: z.string().max(2_000).nullable().optional(),
  accionRequerida: z.enum(['Ninguna', 'Coaching', 'Advertencia']).nullable().optional(),
}).strict();
// Canonical funnel state lives on RecruitmentApplication and may only
// transition through `advanceApplication`; the candidate record itself carries
// no status field, so the patch endpoint cannot be used as a state-machine
// bypass.
export const RecruitmentCandidatePatchSchema = RecruitmentCandidateSchema.partial();


export const PayrollPaySchema = z.object({
  payrollRecordId: z.string().trim().min(1),
  transactionReference: z.string().trim().min(1, 'transactionReference is required for marking payment as PAID').max(255),
});

export const PayrollVerifySchema = z.discriminatedUnion('action', [
  z.object({
    payrollRecordId: z.string().trim().min(1),
    action: z.literal('verify'),
    verifiedMinutes: z.number().int().min(0).max(100_000),
  }),
  z.object({
    payrollRecordId: z.string().trim().min(1),
    action: z.literal('markPaid'),
  }),
  z.object({
    payrollRecordId: z.string().trim().min(1),
    action: z.literal('updateStatus'),
    status: z.enum(['PENDING', 'APPROVED', 'PAID', 'REJECTED']),
  }),
]);
