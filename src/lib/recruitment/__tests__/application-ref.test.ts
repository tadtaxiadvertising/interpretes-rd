import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createApplicationRef,
  verifyApplicationRef,
  APPLICATION_REF_COOKIE,
} from '@/lib/recruitment/application-ref';

describe('application-ref (signed ownership cookie)', () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = 'unit-test-secret';
  });

  afterEach(() => {
    delete process.env.AUTH_SECRET;
  });

  it('round-trips candidate and application ids', () => {
    const value = createApplicationRef(42, 'cml0abc');
    expect(value).toBeTruthy();
    const ref = verifyApplicationRef(value);
    expect(ref).not.toBeNull();
    expect(ref!.candidateId).toBe(42);
    expect(ref!.applicationId).toBe('cml0abc');
  });

  it('rejects a tampered payload', () => {
    const value = createApplicationRef(42, 'cml0abc')!;
    const [, payload, signature] = value.split('.');
    const tampered = Buffer.from(
      JSON.stringify({ c: 1, a: 'other', e: Date.now() + 100000 }),
      'utf8'
    ).toString('base64url');
    expect(verifyApplicationRef(`1.${tampered}.${signature}`)).toBeNull();
    expect(verifyApplicationRef(`1.${payload}.forged-signature`)).toBeNull();
  });

  it('rejects a signature made with a different secret', () => {
    const value = createApplicationRef(42, 'cml0abc')!;
    process.env.AUTH_SECRET = 'other-secret';
    expect(verifyApplicationRef(value)).toBeNull();
  });

  it('rejects an expired reference', () => {
    // Issue the reference more than APPLICATION_REF_MAX_AGE_SEC ago.
    const value = createApplicationRef(42, 'cml0abc', Date.now() - 31 * 24 * 60 * 60 * 1000)!;
    expect(verifyApplicationRef(value)).toBeNull();
  });

  it('rejects malformed and empty values', () => {
    expect(verifyApplicationRef(undefined)).toBeNull();
    expect(verifyApplicationRef(null)).toBeNull();
    expect(verifyApplicationRef('')).toBeNull();
    expect(verifyApplicationRef('garbage')).toBeNull();
    expect(verifyApplicationRef('1.only.two')).toBeNull();
  });

  it('fails closed when AUTH_SECRET is not configured', () => {
    delete process.env.AUTH_SECRET;
    expect(createApplicationRef(42, 'cml0abc')).toBeNull();
    expect(verifyApplicationRef('1.payload.signature')).toBeNull();
  });

  it('exposes a stable cookie name', () => {
    expect(APPLICATION_REF_COOKIE).toBe('rd_app_ref');
  });
});
