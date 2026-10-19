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

export const InterpreterPatchSchema = InterpreterSchema.partial().omit({ password: true }).extend({
  password: z.string().min(6, 'Password must be at least 6 characters').max(128).optional(),
});

export const InterpreterPasswordSchema = z.object({
  password: z.string().min(6, 'Password must be at least 6 characters').max(128),
});

export const PayrollRecordPatchSchema = PayrollRecordSchema.partial();
export const QAScorePatchSchema = QAScoreSchema.partial();
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
    verifiedMinutes: z.number().nonnegative(),
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
