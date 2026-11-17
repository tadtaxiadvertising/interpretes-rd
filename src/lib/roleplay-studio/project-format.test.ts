import { describe, expect, it } from 'vitest';
import { STUDIO_DRAFT_FORMAT } from './draft';
import { LOCAL_DRAFT_FORMAT } from './long-media';
import { detectStudioProjectFormat } from './project-format';

describe('Audio Studio project format preflight', () => {
  it('recognizes either format without inferring it from UI preferences', () => {
    expect(detectStudioProjectFormat(JSON.stringify({
      format: LOCAL_DRAFT_FORMAT, version: 1,
    }))).toBe('sampled-local');
    expect(detectStudioProjectFormat(JSON.stringify({
      format: STUDIO_DRAFT_FORMAT, version: 1,
    }))).toBe('complete-sha256');
    expect(detectStudioProjectFormat(JSON.stringify({
      format: LOCAL_DRAFT_FORMAT, version: 2,
    }))).toBe('sampled-local');
  });

  it.each([
    'not a JSON document',
    'null',
    '[]',
    '{}',
    JSON.stringify({ format: STUDIO_DRAFT_FORMAT, version: 3 }),
    JSON.stringify({ format: LOCAL_DRAFT_FORMAT, version: 0 }),
    JSON.stringify({ format: 'unsupported', version: 1 }),
    JSON.stringify({ format: LOCAL_DRAFT_FORMAT, version: '1' }),
  ])('rejects malformed, unrecognized or future-version JSON before hashing (%s)', input => {
    expect(() => detectStudioProjectFormat(input)).toThrow(/JSON|formato/);
  });

  it('does not validate segments in the preflight: strict draft reader still handles them', () => {
    expect(detectStudioProjectFormat(JSON.stringify({
      format: LOCAL_DRAFT_FORMAT, version: 1, segments: ['invalid'],
    }))).toBe('sampled-local');
  });
});
