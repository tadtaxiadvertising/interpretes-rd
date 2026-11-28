import { describe, expect, it } from 'vitest';
import { summarizeCreationReadiness } from './creation-readiness-summary';
import { readCreationPilotConfig } from './creation-pilot-config';
import { readDirectUploadPilotConfig, OPENING_ASSIGNMENT_FLAGS, DIRECT_UPLOAD_FORM_FLAGS } from './direct-upload-pilot-config';
import type { DirectCatalogDiagnostic } from './direct-upload-catalog-readiness';
import type { DirectRolloutMetadata } from './direct-upload-rollout-inspection';

const env = { ...Object.fromEntries([...OPENING_ASSIGNMENT_FLAGS, ...DIRECT_UPLOAD_FORM_FLAGS].map(name => [name, 'true'])),
  NEXT_PUBLIC_SUPABASE_URL: 'fixture', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture',
  SUPABASE_SERVICE_ROLE_KEY: 'fixture', FRONTEND_ORIGIN: 'fixture' };
const catalog: DirectCatalogDiagnostic = { reservation: 'catalog-ready', budget: 'accounting-consistent',
  permissions: { state: 'recognized', tables: [] }, capacity: { maxSlots: 25, allocatedSlots: 10, remainingSlots: 15 } };
const rollout: DirectRolloutMetadata = {
  schemaMetadataReady: true, tableChecks: [], triggerChecks: [],
  columnChecks: { opening: true, capability: true, releaseGate: true, assignmentHash: true },
  buckets: [{ id: 'roleplay-audio-private', state: 'metadata-ready' }, { id: 'roleplay-opening-private', state: 'metadata-ready' }],
};
const input = { pilot: readCreationPilotConfig({}), direct: readDirectUploadPilotConfig(env), buildId: 'a'.repeat(40),
  ready: true, catalog, rollout, rolloutRequested: true };

describe('integral diagnostic summary', () => {
  it('never authorizes activation, even with all local checks recognized', () => {
    const result = summarizeCreationReadiness(input);
    expect(result).toMatchObject({ recognized: 8, review: 0, unchecked: 0, activationAuthorized: false });
    expect(result.externalChecks).toHaveLength(3);
    expect(result.recoveryConfigured).toBe(false);
  });

  it('distinguishes unchecked probes from failed probes', () => {
    const absent = summarizeCreationReadiness({ ...input, ready: null, catalog: null, rollout: null, rolloutRequested: false });
    expect(absent).toMatchObject({ recognized: 2, review: 0, unchecked: 6 });
    const failed = summarizeCreationReadiness({ ...input, ready: false, catalog: { ...catalog, reservation: 'unavailable',
      budget: 'unavailable', permissions: { state: 'unavailable', tables: [] }, capacity: null }, rollout: null });
    expect(failed).toMatchObject({ recognized: 2, review: 6, unchecked: 0 });
  });

  it('requires review for exhausted capacity and a missing private bucket', () => {
    const result = summarizeCreationReadiness({ ...input,
      catalog: { ...catalog, capacity: { maxSlots: 25, allocatedSlots: 25, remainingSlots: 0 } },
      rollout: { ...rollout, buckets: [rollout.buckets[0]] },
    });
    expect(result.checks.filter(c => c.state === 'review').map(c => c.id)).toEqual(['budget', 'buckets']);
    expect(result.activationAuthorized).toBe(false);
  });
});
