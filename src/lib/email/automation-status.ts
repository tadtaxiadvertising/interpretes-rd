import { readOperationalMailConfig } from './operational-config';
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
