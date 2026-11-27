type PilotEnvironment = {
  ROLEPLAY_CREATION_IDEMPOTENCY_ENABLED?: string;
  ROLEPLAY_IDEMPOTENCY_RECEIPTS_ENABLED?: string;
};

export type CreationPilotMode = 'disabled' | 'receipts-only' | 'blocked-missing-receipts' | 'pilot-configured';

/** Configuration only, not schema readiness or approval to activate. */
export function readCreationPilotConfig(env: PilotEnvironment) {
  const creationRequested = env.ROLEPLAY_CREATION_IDEMPOTENCY_ENABLED === 'true';
  const receiptsEnabled = env.ROLEPLAY_IDEMPOTENCY_RECEIPTS_ENABLED === 'true';
  const keyedCreationEnabled = creationRequested && receiptsEnabled;
  const mode: CreationPilotMode = creationRequested
    ? receiptsEnabled ? 'pilot-configured' : 'blocked-missing-receipts'
    : receiptsEnabled ? 'receipts-only' : 'disabled';
  return { mode, keyedCreationEnabled, receiptsEnabled };
}
