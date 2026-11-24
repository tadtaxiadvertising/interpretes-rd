import { readOperationalMailConfig } from './operational-config';

export function recruitmentDispatchCutover(env: Readonly<Record<string, string | undefined>>, now: Date): Date | null {
  if (env.OPERATIONAL_EMAIL_DISPATCH_ENABLED !== 'true' || env.OPERATIONAL_EMAIL_BINDING_ENABLED !== 'true'
    || readOperationalMailConfig(env).status !== 'configured') return null;
  const raw = env.OPERATIONAL_EMAIL_DISPATCH_NOT_BEFORE;
  if (!raw || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(raw)) return null;
  const cutover = new Date(raw);
  if (!Number.isFinite(cutover.getTime()) || cutover.toISOString() !== raw.replace('Z', '.000Z') || cutover > now) return null;
  return cutover;
}
