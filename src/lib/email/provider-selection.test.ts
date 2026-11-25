import { describe, it, expect } from 'vitest';
import { providerSelectionPaused, validProfileId } from './provider-selection';

const paused = {
  EMAIL_PROVIDER_VAULT_ENABLED: 'true', OPERATIONAL_EMAIL_ENABLED: 'true',
  OPERATIONAL_EMAIL_DISPATCH_ENABLED: 'false', OPERATIONAL_EMAIL_BATCH_ENABLED: 'false',
  OPERATIONAL_EMAIL_BINDING_ENABLED: 'false', OPERATIONAL_EMAIL_GENERAL_ENABLED: 'false',
  OPERATIONAL_EMAIL_SCHEDULER_ENABLED: 'false',
};
describe('provider selection gates', () => {
  it('requires explicit disabled flags rather than missing or ambiguous settings', () => {
    expect(providerSelectionPaused(paused)).toBe(true);
    for (const [key, value] of Object.entries(paused)) {
      expect(providerSelectionPaused({ ...paused, [key]: undefined })).toBe(false);
      expect(providerSelectionPaused({ ...paused, [key]: value === 'true' ? 'false' : 'true' })).toBe(false);
    }
  });
  it('accepts only a UUID-shaped string', () => {
    expect(validProfileId('123e4567-e89b-42d3-a456-426614174000')).toBe(true);
    expect(validProfileId(null)).toBe(false);
    expect(validProfileId('invalid')).toBe(false);
  });
});
