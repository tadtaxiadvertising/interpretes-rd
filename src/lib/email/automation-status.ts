import { readOperationalMailConfig } from './operational-config';
import { emailDeliveryMode } from './pilot-recipient';
import { validEmailSchedulerSecret } from './scheduler-auth';

export function emailAutomationStatus(env: Readonly<Record<string, string | undefined>>, now = new Date()) {
  const cutover = env.OPERATIONAL_EMAIL_DISPATCH_NOT_BEFORE;
  const date = new Date(cutover ?? '');
  const cutoverValid = !!cutover && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(cutover)
    && Number.isFinite(date.getTime()) && date <= now && date.toISOString() === cutover.replace('Z', '.000Z');
  return {
    smtpConfigured: readOperationalMailConfig(env).status === 'configured',
    bindingEnabled: env.OPERATIONAL_EMAIL_BINDING_ENABLED === 'true',
    dispatchEnabled: env.OPERATIONAL_EMAIL_DISPATCH_ENABLED === 'true',
    batchEnabled: env.OPERATIONAL_EMAIL_BATCH_ENABLED === 'true',
    schedulerEnabled: env.OPERATIONAL_EMAIL_SCHEDULER_ENABLED === 'true',
    schedulerCredentialConfigured: validEmailSchedulerSecret(env.OPERATIONAL_EMAIL_SCHEDULER_SECRET),
    cutoverValid,
  };
}

/** Mode-aware UI diagnosis. Configuration readiness is not delivery proof. */
export function emailRolloutReadiness(env: Readonly<Record<string, string | undefined>>, now = new Date()) {
  const mode = emailDeliveryMode(env);
  const flags = emailAutomationStatus(env, now);
  const common: [string, boolean][] = [
    ['Proveedor de correo configurado', flags.smtpConfigured],
    ['Vinculación habilitada', flags.bindingEnabled],
    ['Despacho habilitado', flags.dispatchEnabled],
    ['Lotes habilitados', flags.batchEnabled],
    ['Fecha de inicio válida', flags.cutoverValid],
  ];
  const checks: [string, boolean][] = mode === 'pilot'
    ? [...common, ['Programador desactivado para el piloto', !flags.schedulerEnabled]]
    : mode === 'general'
      ? [...common, ['Programador habilitado', flags.schedulerEnabled], ['Credencial del programador válida', flags.schedulerCredentialConfigured]]
      : [...common, ['Modo de entrega válido y exclusivo', false]];
  return { mode, checks, ready: checks.every(([, ok]) => ok) };
}
