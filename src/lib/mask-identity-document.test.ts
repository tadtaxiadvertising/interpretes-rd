import { describe, expect, it } from 'vitest';
import { maskIdentityDocument } from './mask-identity-document';

describe('maskIdentityDocument', () => {
  it.each([
    ['001-1234567-8', '••••78'],
    ['00112345678', '••••78'],
    ['123456789', '••••89'],
    ['123-456789-0', '••••90'],
  ])('masks formatted and unformatted identity documents: %s', (input, expected) => {
    expect(maskIdentityDocument(input)).toBe(expected);
    expect(maskIdentityDocument(input)).not.toContain(input);
  });

  it.each(['1', '12', '123', 'abc', 'RNC'])(
    'does not reveal short or malformed identity values: %s',
    (input) => {
      expect(maskIdentityDocument(input)).toBe('••••');
    },
  );

  it('renders a neutral placeholder when the document is missing', () => {
    expect(maskIdentityDocument('')).toBe('—');
    expect(maskIdentityDocument('   ')).toBe('—');
    expect(maskIdentityDocument(null)).toBe('—');
    expect(maskIdentityDocument(undefined)).toBe('—');
  });
});
