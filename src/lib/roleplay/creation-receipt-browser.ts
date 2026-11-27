export type SingleCreationRecovery =
  | { status: 'COMPLETED' }
  | { status: 'NOT_FOUND' | 'IN_PROGRESS' | 'REVIEW_REQUIRED' | 'UNAVAILABLE' };

/** Query one existing attempt. No media, destination metadata or new creation. */
export async function recoverSingleRoleplayCreation(
  requestKey: string,
  expectedScenarioCount: number,
  fetcher: typeof fetch = fetch,
): Promise<SingleCreationRecovery> {
  try {
    const response = await fetcher('/api/admin/roleplays/creation-receipt', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestKey }), cache: 'no-store',
    });
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
        data.sessionIds.length === 1 && typeof data.sessionIds[0] === 'string' && data.sessionIds[0].trim()) {
      return { status: 'COMPLETED' };
    }
    return { status: 'REVIEW_REQUIRED' };
  } catch {
    return { status: 'UNAVAILABLE' };
  }
}
