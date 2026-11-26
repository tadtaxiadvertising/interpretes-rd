'use server';

import { validateAction } from '@/lib/auth/actions';

/** Compatibility endpoint for old clients. The legacy calculator counted both
 * production logs and already-synced live sessions and settled them directly.
 * Do not silently delegate: the current generator has different semantics. */
export async function calculateInterpreterPayrollAction(
  _prevState: unknown,
  _formData: FormData,
): Promise<{ success: false; error: string; code: string }> {
  const authorization = await validateAction('admin');
  if ('error' in authorization) return { success: false, error: authorization.error, code: authorization.code };
  return {
    success: false,
    code: 'LEGACY_PAYROLL_DISABLED',
    error: 'La calculadora anterior está deshabilitada. Utiliza Generar nómina en el módulo Nómina para calcular con el motor actual.',
  };
}
