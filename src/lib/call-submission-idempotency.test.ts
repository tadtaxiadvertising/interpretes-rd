import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  classifyQuickLogReplay,
  fingerprintQuickLogSubmission,
  MAX_QUICK_LOG_SECONDS,
  normalizeQuickLogRequestKey,
  QUICK_LOG_FINGERPRINT_VERSION,
  type ExistingQuickLogKey,
  type QuickLogSubmission,
} from './call-submission-idempotency';

const REQUEST_KEY = '8DE42759-4957-48BF-9F94-3C610215ADAA';
const payload: QuickLogSubmission = {
  interpreterId: 7,
  source: 'quick_log_action',
  durationSeconds: 125,
};

function stored(overrides: Partial<ExistingQuickLogKey> = {}): ExistingQuickLogKey {
  return {
    interpreterId: 7,
    requestKey: REQUEST_KEY.toLowerCase(),
    source: 'quick_log_action',
    payloadSha256: fingerprintQuickLogSubmission(payload),
    callSessionId: 41,
    ...overrides,
  };
}

describe('staged Quick Log idempotency contract (not connected to live calls)', () => {
  it('accepts only proper UUIDv4 keys, normalizes case, and never generates a fallback key', () => {
    expect(normalizeQuickLogRequestKey(REQUEST_KEY)).toBe(REQUEST_KEY.toLowerCase());
    expect(normalizeQuickLogRequestKey(REQUEST_KEY.toLowerCase())).toBe(REQUEST_KEY.toLowerCase());
    for (const invalid of [
      undefined, null, {}, 123, '', '  ' + REQUEST_KEY,
      '00000000-0000-0000-0000-000000000000',
      '00000000-0000-1000-8000-000000000000',
      '00000000-0000-4000-0000-000000000000',
      'not-a-uuid', '8de42759495748bf9f943c610215adaa',
    ]) {
      expect(normalizeQuickLogRequestKey(invalid)).toBeNull();
    }
  });

  it('produces a stable, versioned, lowercase SHA-256 digest from a fixed canonical tuple', () => {
    expect(QUICK_LOG_FINGERPRINT_VERSION).toBe(1);
    const expectedCanonical = JSON.stringify([
      'interpretes-rd-call-submission', 1, 7, 'quick_log_action', 125,
    ]);
    const expected = createHash('sha256').update(expectedCanonical, 'utf8').digest('hex');
    expect(fingerprintQuickLogSubmission(payload)).toBe(expected);
    expect(fingerprintQuickLogSubmission({ ...payload })).toBe(expected);
    expect(expected).toMatch(/^[a-f0-9]{64}$/);
  });

  it('separates interpreters, sources and durations even for identical request keys', () => {
    const original = fingerprintQuickLogSubmission(payload);
    expect(fingerprintQuickLogSubmission({ ...payload, interpreterId: 8 })).not.toBe(original);
    expect(fingerprintQuickLogSubmission({ ...payload, source: 'quick_log_api' })).not.toBe(original);
    expect(fingerprintQuickLogSubmission({ ...payload, durationSeconds: 126 })).not.toBe(original);
  });

  it('uses whole stored seconds, so 1.5 minutes and 90 seconds can share a fingerprint', () => {
    const fromApi = { ...payload, source: 'quick_log_api' as const,
      durationSeconds: Math.round(1.5 * 60) };
    const fromSeconds = { ...payload, source: 'quick_log_api' as const,
      durationSeconds: 90 };
    expect(fingerprintQuickLogSubmission(fromApi))
      .toBe(fingerprintQuickLogSubmission(fromSeconds));
  });

  it('enforces strict bounds and refuses unknown sources without echoing submitted data', () => {
    for (const seconds of [
      0, -1, 0.5, Number.NaN, Infinity, -Infinity, MAX_QUICK_LOG_SECONDS + 1,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(() => fingerprintQuickLogSubmission({ ...payload, durationSeconds: seconds }))
        .toThrow('Invalid Quick Log idempotency payload');
    }
    for (const interpreterId of [0, -1, 1.5, NaN, Infinity]) {
      expect(() => fingerprintQuickLogSubmission({ ...payload, interpreterId }))
        .toThrow('Invalid Quick Log idempotency payload');
    }
    expect(() => fingerprintQuickLogSubmission({
      ...payload, source: 'admin_manual' as never,
    })).toThrow('Invalid Quick Log idempotency payload');
    expect(() => fingerprintQuickLogSubmission({ ...payload, durationSeconds: MAX_QUICK_LOG_SECONDS }))
      .not.toThrow();
  });

  it('classifies a new request only when the key is valid and no mapping is present', () => {
    expect(classifyQuickLogReplay(null, REQUEST_KEY, payload)).toEqual({ kind: 'NEW' });
    expect(classifyQuickLogReplay(null, 'not-a-key', payload)).toEqual({ kind: 'CONFLICT' });
  });

  it('returns the existing session ID for the exact same user, source and duration', () => {
    expect(classifyQuickLogReplay(stored(), REQUEST_KEY, payload)).toEqual({
      kind: 'REPLAY', callSessionId: 41,
    });
    expect(classifyQuickLogReplay(stored(), REQUEST_KEY.toLowerCase(), payload)).toEqual({
      kind: 'REPLAY', callSessionId: 41,
    });
  });

  it('rejects key reuse with changed duration, source or interpreter, and corrupted associations', () => {
    const variants: Array<[ExistingQuickLogKey, string, QuickLogSubmission]> = [
      [stored(), REQUEST_KEY, { ...payload, durationSeconds: 90 }],
      [stored(), REQUEST_KEY, { ...payload, source: 'quick_log_api' }],
      [stored(), REQUEST_KEY, { ...payload, interpreterId: 8 }],
      [stored({ requestKey: 'cc67e7d3-566b-41d4-b01d-5f584b337461' }), REQUEST_KEY, payload],
      [stored({ source: 'quick_log_api' }), REQUEST_KEY, payload],
      [stored({ payloadSha256: '0'.repeat(64) }), REQUEST_KEY, payload],
      [stored({ callSessionId: 0 }), REQUEST_KEY, payload],
    ];
    for (const [existing, key, submitted] of variants) {
      expect(classifyQuickLogReplay(existing, key, submitted)).toEqual({ kind: 'CONFLICT' });
    }
  });

  it('never accepts an unrecognized payload or UUID simply because the row matches', () => {
    expect(classifyQuickLogReplay(stored(), 'invalid', payload)).toEqual({ kind: 'CONFLICT' });
    expect(() => classifyQuickLogReplay(stored(), REQUEST_KEY, {
      ...payload, durationSeconds: Infinity,
    })).toThrow('Invalid Quick Log idempotency payload');
  });
});
