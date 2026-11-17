// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { issueHappyScribeImportProof, verifyHappyScribeImportProof } from './happyscribe-import-proof';

const scope = {
  id: 'a'.repeat(40),
  organizationId: '12345',
  userId: 'synthetic-admin',
  token: 'SYNTHETIC_NOT_A_REAL_PROVIDER_CREDENTIAL',
};
const now = 1_800_000_000_000;

describe('HappyScribe signed import selection', () => {
  it('accepts a listing-origin selection within the same organization and admin session', () => {
    const proof = issueHappyScribeImportProof(scope, now);
    expect(verifyHappyScribeImportProof(scope, proof, now + 60_000)).toBe(true);
  });

  it('rejects another organization, admin, ID or token', () => {
    const proof = issueHappyScribeImportProof(scope, now);
    for (const changed of [
      { ...scope, organizationId: '67890' },
      { ...scope, userId: 'another-admin' },
      { ...scope, id: 'b'.repeat(40) },
      { ...scope, token: 'ROTATED_TOKEN' },
    ]) expect(verifyHappyScribeImportProof(changed, proof, now)).toBe(false);
  });

  it('rejects expired, future, forged and malformed proofs before export', () => {
    const proof = issueHappyScribeImportProof(scope, now);
    expect(verifyHappyScribeImportProof(scope, proof, now + 46 * 60_000)).toBe(false);
    expect(verifyHappyScribeImportProof(scope, proof, now - 60_000)).toBe(false);
    expect(verifyHappyScribeImportProof(scope, undefined, now)).toBe(false);
    const finalChar = proof.slice(-1);
    const tampered = proof.slice(0, -1) + (finalChar === '0' ? '1' : '0');
    expect(verifyHappyScribeImportProof(scope, tampered, now)).toBe(false);
    expect(verifyHappyScribeImportProof(scope, 'not-a-proof', now)).toBe(false);
  });

  it('does not serialize the provider API token into the proof', () => {
    const proof = issueHappyScribeImportProof(scope, now);
    expect(proof).not.toContain(scope.token);
    expect(proof.length).toBe(78);
  });
});
