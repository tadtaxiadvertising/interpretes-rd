import { describe, expect, it } from 'vitest';
import { readCreationPilotConfig } from './creation-pilot-config';

describe('creation pilot configuration', () => {
  it.each([
    [false, false, 'disabled', false, false],
    [false, true, 'receipts-only', false, true],
    [true, false, 'blocked-missing-receipts', false, false],
    [true, true, 'pilot-configured', true, true],
  ] as const)('creation=%s receipts=%s gives %s', (creation, receipts, mode, keyedCreationEnabled, receiptsEnabled) => {
    expect(readCreationPilotConfig({
      ROLEPLAY_CREATION_IDEMPOTENCY_ENABLED: String(creation),
      ROLEPLAY_IDEMPOTENCY_RECEIPTS_ENABLED: String(receipts),
    })).toEqual({ mode, keyedCreationEnabled, receiptsEnabled });
  });
  it.each([undefined, '', 'TRUE', '1', ' true', 'true ', 'yes'])('does not implicitly activate either feature with %s', value => {
    expect(readCreationPilotConfig({
      ROLEPLAY_CREATION_IDEMPOTENCY_ENABLED: value,
      ROLEPLAY_IDEMPOTENCY_RECEIPTS_ENABLED: value,
    })).toEqual({ mode: 'disabled', keyedCreationEnabled: false, receiptsEnabled: false });
  });
  it('reads the current configuration without retaining a stale enabled state', () => {
    const env = {
      ROLEPLAY_CREATION_IDEMPOTENCY_ENABLED: 'true',
      ROLEPLAY_IDEMPOTENCY_RECEIPTS_ENABLED: 'true',
    };
    expect(readCreationPilotConfig(env).keyedCreationEnabled).toBe(true);
    env.ROLEPLAY_CREATION_IDEMPOTENCY_ENABLED = 'false';
    expect(readCreationPilotConfig(env).mode).toBe('receipts-only');
  });
});
