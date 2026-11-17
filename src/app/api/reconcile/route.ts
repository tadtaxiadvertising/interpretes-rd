import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withSecurity } from '@/lib/api-security';
import { guardApiAuth } from '@/lib/api-auth';
import { privateAdminJson, privateAdminResponse } from '@/lib/security/private-admin-response';
import { reconcileProductionMinutes } from '@/lib/payroll/reconcile-production-minutes';

const ReconcileBody = z.object({
  logId: z.number().int().positive(),
  verifiedMinutes: z.number().int().min(0).max(100_000),
}).strict();

/**
 * Legacy HTTP endpoint delegates to exactly the same transactional rules as
 * the admin Server Action. No direct writes or "paid status only" shortcuts.
 */
export const PATCH = withSecurity(async (request: NextRequest) => {
  const denied = await guardApiAuth(request, 'admin');
  if (denied) return privateAdminResponse(denied);

  const { logId, verifiedMinutes } = ReconcileBody.parse(await request.json());
  const result = await reconcileProductionMinutes(logId, verifiedMinutes);

  if (result.kind === 'UPDATED') {
    return privateAdminJson({ success: true, data: result.log });
  }

  const failures = {
    NOT_FOUND: { status: 404, error: 'Production log not found' },
    INVALID_LOG: { status: 400, error: 'Production log is not linked to an interpreter' },
    SETTLED: { status: 409, error: 'Cannot modify a settled production log' },
    LOCKED_PAYROLL: { status: 409, error: 'Cannot modify production linked to an approved or paid payroll' },
    CONFLICT: { status: 409, error: 'Production log changed; reload and try again' },
    OVERLAPPING_PAYROLLS: { status: 409, error: 'Overlapping payroll periods require administrative review before reconciliation' },
    PAYROLL_LINK_MISMATCH: { status: 409, error: 'The production log payroll link requires administrative review' },
  } as const;
  const failure = failures[result.kind];
  return privateAdminJson({ success: false, error: failure.error }, { status: failure.status });
}, { body: ReconcileBody });
