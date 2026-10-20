import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { corsHeaders, resolveCorsOrigin } from '../cors';

const originalCorsOrigin = process.env.CORS_ORIGIN;

function request(origin?: string): Request {
  return new Request('http://localhost/api/v1/recruitment', {
    headers: origin ? { origin } : {},
  });
}

describe('resolveCorsOrigin', () => {
  afterEach(() => {
    if (originalCorsOrigin === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = originalCorsOrigin;
  });

  it('denies every origin when CORS_ORIGIN is unset', () => {
    delete process.env.CORS_ORIGIN;

    expect(resolveCorsOrigin('https://evil.example')).toBeNull();
    expect(resolveCorsOrigin(null)).toBeNull();
  });

  it('denies every origin when CORS_ORIGIN is blank', () => {
    process.env.CORS_ORIGIN = '   ';

    expect(resolveCorsOrigin('https://evil.example')).toBeNull();
  });

  it('allows only explicitly listed origins', () => {
    process.env.CORS_ORIGIN = 'https://admin.example, https://hr.example';

    expect(resolveCorsOrigin('https://hr.example')).toBe('https://hr.example');
    expect(resolveCorsOrigin('https://evil.example')).toBeNull();
    expect(resolveCorsOrigin(null)).toBeNull();
  });

  it('echoes nothing for an unspecified origin even when * is configured', () => {
    process.env.CORS_ORIGIN = '*';

    expect(resolveCorsOrigin('https://anything.example')).toBe('*');
    expect(resolveCorsOrigin(null)).toBe('*');
  });
});

describe('corsHeaders', () => {
  beforeEach(() => {
    delete process.env.CORS_ORIGIN;
  });

  afterEach(() => {
    if (originalCorsOrigin === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = originalCorsOrigin;
  });

  it('emits no headers by default (deny)', () => {
    expect(corsHeaders(request('https://evil.example'))).toEqual({});
  });

  it('grants the matching origin and varies on Origin', () => {
    process.env.CORS_ORIGIN = 'https://hr.example';

    const headers = corsHeaders(request('https://hr.example'), 'GET, OPTIONS');

    expect(headers).toEqual({
      'Access-Control-Allow-Origin': 'https://hr.example',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      Vary: 'Origin',
    });
  });

  it('grants nothing for a non-matching origin', () => {
    process.env.CORS_ORIGIN = 'https://hr.example';

    expect(corsHeaders(request('https://evil.example'))).toEqual({});
  });
});
