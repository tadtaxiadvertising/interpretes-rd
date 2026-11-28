import { ROLEPLAY_MAX_SCENARIOS } from '@/lib/roleplay-limits';

const RECOVERY_REFERENCE = /^rp1:([a-f0-9]{8}-[a-f0-9]{4}-[47][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}):([1-9][0-9]?)$/;

export type CreationRecoveryReference = { key: string; scenarioCount: number };

/** A correlation reference, NOT an authorization credential or invitation. */
export function parseCreationRecoveryReference(value: string): CreationRecoveryReference | null {
  const match = RECOVERY_REFERENCE.exec(value.trim());
  if (!match) return null;
  const scenarioCount = Number(match[2]);
  if (scenarioCount > ROLEPLAY_MAX_SCENARIOS) return null;
  return { key: match[1], scenarioCount };
}

export function formatCreationRecoveryReference(reference: CreationRecoveryReference): string {
  const value = `rp1:${reference.key}:${reference.scenarioCount}`;
  if (!parseCreationRecoveryReference(value)) throw new Error('Invalid recovery reference');
  return value;
}

/** Only bounded, path-safe session IDs may identify a confirmed creation. */
export function isConfirmedRoleplaySessionId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}

export type SingleCreationRecovery =
  | { status: 'COMPLETED'; sessionId: string }
  | { status: 'NOT_FOUND' | 'IN_PROGRESS' | 'REVIEW_REQUIRED' | 'UNAVAILABLE' | 'ACCESS_REQUIRED' | 'ENDPOINT_UNAVAILABLE' };

export const CREATION_RECEIPT_TIMEOUT_MS = 15_000;

/** Query one existing attempt, with a deadline covering headers and JSON. */
export async function recoverSingleRoleplayCreation(
  requestKey: string,
  expectedScenarioCount: number,
  fetcher: typeof fetch = fetch,
): Promise<SingleCreationRecovery> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<SingleCreationRecovery>(resolve => {
    timer = setTimeout(() => {
      resolve({ status: 'UNAVAILABLE' });
      controller.abort();
    }, CREATION_RECEIPT_TIMEOUT_MS);
  });
  try {
    // Race even if an injected transport fails to honor abort. A late
    // response cannot change the returned result or release the draft.
    return await Promise.race([
      deadline,
      queryReceipt(requestKey, expectedScenarioCount, fetcher, controller.signal),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function queryReceipt(
  requestKey: string,
  expectedScenarioCount: number,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<SingleCreationRecovery> {
  try {
    const response = await fetcher('/api/admin/roleplays/creation-receipt', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestKey }), cache: 'no-store', signal,
    });
    // HTTP failures are not ledger states. Never read or expose their body.
    if (response.status === 401 || response.status === 403) return { status: 'ACCESS_REQUIRED' };
    if (response.status === 404) return { status: 'ENDPOINT_UNAVAILABLE' };
    if (!response.ok) return { status: 'UNAVAILABLE' };
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object' || !('success' in payload) ||
        payload.success !== true || !('data' in payload) || !payload.data ||
        typeof payload.data !== 'object' || !('status' in payload.data)) {
      return { status: 'UNAVAILABLE' };
    }
    const data = payload.data as Record<string, unknown>;
    if (data.status === 'NOT_FOUND' || data.status === 'IN_PROGRESS' || data.status === 'REVIEW_REQUIRED') {
      return { status: data.status };
    }
    if (data.status === 'COMPLETED' && data.createdCount === 1 && data.skippedCount === 0 &&
        data.scenarioCount === expectedScenarioCount && Array.isArray(data.sessionIds) &&
        data.sessionIds.length === 1 && isConfirmedRoleplaySessionId(data.sessionIds[0])) {
      return { status: 'COMPLETED', sessionId: data.sessionIds[0] };
    }
    return { status: 'REVIEW_REQUIRED' };
  } catch {
    return { status: 'UNAVAILABLE' };
  }
}
