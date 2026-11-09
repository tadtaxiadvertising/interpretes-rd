export const REQUIRED_WORKER_ENV_VARS = [
  'DATABASE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const;

export type RequiredWorkerEnvVar = (typeof REQUIRED_WORKER_ENV_VARS)[number];

/**
 * Fail fast when the worker cannot possibly process jobs. Without this check a
 * misconfigured container keeps running (and logging polling errors) while the
 * platform reports it as healthy.
 */
export function findMissingWorkerEnvVars(
  env: Record<string, string | undefined> = process.env,
): RequiredWorkerEnvVar[] {
  return REQUIRED_WORKER_ENV_VARS.filter((name) => !env[name]?.trim());
}
