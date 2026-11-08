export interface RoleplayAudioLeaseJob {
  id: string;
  scenarioId: string;
  sourceAudioPath: string;
}

interface LeaseGuardCallbacks {
  renewOwnedLease: () => Promise<boolean>;
  markResponseProcessing: () => Promise<number>;
}

/**
 * Guard the response state transition with the queue lease in the same
 * database transaction. A stale worker must never downgrade a READY response.
 */
export async function markResponseProcessingIfLeaseOwned(
  callbacks: LeaseGuardCallbacks,
): Promise<boolean> {
  const ownsLease = await callbacks.renewOwnedLease();
  if (!ownsLease) return false;

  const updatedResponses = await callbacks.markResponseProcessing();
  if (updatedResponses !== 1) {
    throw new Error('The source response no longer exists for this conversion job');
  }

  return true;
}
